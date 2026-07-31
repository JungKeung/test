// server.js
// SoopScope(비공식 사이트)의 도전미션 API를 조회해서, 요청받은 스트리머(bj 또는 nick)가
// "현재 진행 중인" 도전미션과 "미확정"(종료됐지만 성공/실패로 판정되지 않은) 도전미션을
// 모두 모아, 그 후원자를 닉네임 기준으로 합산한 뒤 TOP5를 돌려주는 서버입니다.
//
// 특정 스트리머 하나로 고정되어 있지 않고, 요청마다 ?bj=아이디 또는 ?nick=닉네임을 받아서
// 그 스트리머만 조회합니다. 그래서 broadcast.html?bj=아무개 형태로 누구든 각자 쓸 수 있습니다.
//
// SOOP 공식 OAuth/Chat SDK는 전혀 사용하지 않습니다.
// SoopScope API는 브라우저가 아니라 이 서버(Node.js)에서만 호출합니다.

require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 같은 스트리머(bj/nick)를 이 시간(ms) 안에 다시 요청하면, SoopScope를 다시 부르지 않고
// 메모리에 저장해둔 결과를 그대로 돌려줍니다. (요구사항 6: 과도한 호출 방지)
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 30000;

const SOOPSCOPE_BASE = 'https://soopscope.com';

// SoopScope는 Cookie나 Authorization 없이도 응답하지만, 브라우저처럼 보이는
// User-Agent가 없으면 403을 돌려줍니다. 그래서 User-Agent만 지정해서 호출합니다.
const SOOPSCOPE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json',
};

app.use(express.static(path.join(__dirname, 'public')));

// 스트리머(bj 또는 nick)별로 마지막 조회 결과를 저장해둡니다. (요구사항 5: URL마다 독립적으로 조회)
// key -> { data, fetchedAt }
const missionCache = new Map();

// 같은 스트리머에 대한 요청이 짧은 시간 안에 동시에 여러 번 들어와도,
// SoopScope 조회를 중복으로 시작하지 않도록 "진행 중인 조회"를 잠깐 공유합니다.
// key -> Promise
const inFlightFetches = new Map();

function cacheKeyFor({ bj, nick }) {
  return bj ? `bj:${bj}` : `nick:${nick}`;
}

// 제목에 이 단어들이 들어간 미션은 스트리머와 상관없이 항상 집계에서 제외합니다.
const EXCLUDED_TITLE_KEYWORDS = ['도시락'];

function isExcludedMission(item) {
  return EXCLUDED_TITLE_KEYWORDS.some((keyword) => (item.title || '').includes(keyword));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: SOOPSCOPE_HEADERS });
  if (!res.ok) {
    throw new Error(`SoopScope 응답 오류 (HTTP ${res.status})`);
  }
  return res.json();
}

// 미션 목록(mission summary 배열)을 받아서, 각 미션의 상세(allDonors)를 병렬로 조회한 뒤
// 닉네임 기준으로 합산하고 TOP5를 뽑습니다. active 미션 합산과 미확정 미션 합산이
// 로직이 똑같아서 공용으로 뺐습니다.
async function aggregateDonorsAcrossMissions(missions) {
  const details = await Promise.all(
    missions.map((mission) =>
      fetchJson(`${SOOPSCOPE_BASE}/api/challenge/${mission.missionKey}`).catch((error) => {
        console.warn(`미션 ${mission.missionKey} 상세 조회 실패, 이 미션은 건너뜁니다:`, error.message);
        return null;
      })
    )
  );

  const starsByNickname = new Map();
  for (const detail of details) {
    if (!detail) continue; // 실패한 미션은 건너뜀
    for (const donor of detail.allDonors || []) {
      const accumulated = starsByNickname.get(donor.nickname) || 0;
      starsByNickname.set(donor.nickname, accumulated + donor.stars);
    }
  }

  const topRanking = Array.from(starsByNickname.entries())
    .map(([nickname, stars]) => ({ nickname, stars }))
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 5)
    .map((donor, index) => ({ rank: index + 1, ...donor }));

  return topRanking;
}

// 진행 중(active)인 미션 목록만 가져옵니다.
async function fetchActiveMissionList({ bj, nick }) {
  const searchTerm = bj || nick;

  // SoopScope의 검색(q)은 닉네임과 아이디 둘 다 찾아줍니다.
  const listUrl =
    `${SOOPSCOPE_BASE}/api/challenge?status=active&sort=recent&limit=50&offset=0` +
    `&q=${encodeURIComponent(searchTerm)}`;
  const list = await fetchJson(listUrl);

  // bj가 주어졌으면 bjId가 정확히 일치하는 것만, nick이 주어졌으면 bjNick이 정확히 일치하는 것만 남깁니다.
  // 주의: 여기서 1개만 고르지 않고, 조건에 맞는 active 미션을 전부 사용합니다.
  return (list.items || []).filter((item) => {
    if (item.status !== 'active') return false;
    if (isExcludedMission(item)) return false;
    if (bj) return item.bjId === bj;
    return item.bjNick === nick;
  });
}

// "미확정" 상태인 미션 목록만 가져옵니다.
// SoopScope에서 미션은 종료(status: completed)되면 result가 success/fail로 정해지는데,
// 스트리머가 판정하지 않고 자동 종료(auto_zombie_close 등)된 경우엔 success/fail이 아닌
// 값이 남고, 사이트에서는 이걸 "미확정"이라고 표시합니다.
async function fetchUnconfirmedMissionList({ bj, nick }) {
  const searchTerm = bj || nick;

  const listUrl =
    `${SOOPSCOPE_BASE}/api/challenge?status=completed&sort=recent&limit=50&offset=0` +
    `&q=${encodeURIComponent(searchTerm)}`;
  const list = await fetchJson(listUrl);

  return (list.items || []).filter((item) => {
    if (item.status !== 'completed') return false;
    if (item.result === 'success' || item.result === 'fail') return false; // 성공/실패로 판정된 건 제외
    if (isExcludedMission(item)) return false;
    if (bj) return item.bjId === bj;
    return item.bjNick === nick;
  });
}

// 특정 스트리머(bj 또는 nick)의 "진행 중인" 미션과 "미확정" 미션을 항상 같이 가져와서,
// 둘을 합친 전체 후원자(allDonors)를 닉네임 기준으로 합산한 뒤 TOP5를 계산합니다.
// (진행 중인 미션이 있어도 미확정 미션을 무시하지 않고 항상 같이 더합니다.)
async function fetchMissionData({ bj, nick }) {
  const searchTerm = bj || nick;

  const [activeMissions, unconfirmedMissions] = await Promise.all([
    fetchActiveMissionList({ bj, nick }),
    fetchUnconfirmedMissionList({ bj, nick }).catch((error) => {
      console.warn(`미확정 미션 조회 실패 (${searchTerm}), 미확정 없이 진행합니다:`, error.message);
      return [];
    }),
  ]);

  const allMissions = [...activeMissions, ...unconfirmedMissions];

  if (allMissions.length === 0) {
    return {
      hasMission: false,
      bjId: bj || null,
      bjNick: nick || null,
      missionCount: 0,
      totalStars: 0,
      topRanking: [],
      missionStatus: 'none',
      updatedAt: new Date().toISOString(),
    };
  }

  // 미션 목록 자체에 들어있는 totalStars를 더합니다. 아래 상세 조회가 일부 실패하더라도
  // "전체 별풍선 총합"만큼은 정확하게 유지하기 위해, 상세 조회 결과와는 별도로 계산합니다.
  const totalStars = allMissions.reduce((sum, mission) => sum + (mission.totalStars || 0), 0);
  const topRanking = await aggregateDonorsAcrossMissions(allMissions);

  const missionStatus =
    activeMissions.length > 0 && unconfirmedMissions.length > 0
      ? 'active+unconfirmed'
      : activeMissions.length > 0
      ? 'active'
      : 'unconfirmed';

  return {
    hasMission: true,
    bjId: allMissions[0].bjId,
    bjNick: allMissions[0].bjNick,
    missionCount: allMissions.length,
    activeMissionCount: activeMissions.length,
    unconfirmedMissionCount: unconfirmedMissions.length,
    totalStars,
    topRanking,
    missionStatus,
    updatedAt: new Date().toISOString(),
  };
}

// 캐시 → 진행 중인 조회 공유 → 새 조회, 순서로 데이터를 가져옵니다.
async function getMissionDataCached({ bj, nick }) {
  const key = cacheKeyFor({ bj, nick });
  const cached = missionCache.get(key);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  // 같은 스트리머를 지금 막 다른 요청이 이미 조회하고 있다면, 그 결과를 같이 기다립니다.
  if (inFlightFetches.has(key)) {
    const data = await inFlightFetches.get(key);
    return { ...data, cached: false };
  }

  const fetchPromise = fetchMissionData({ bj, nick })
    .then((data) => {
      missionCache.set(key, { data, fetchedAt: Date.now() });
      return data;
    })
    .finally(() => {
      inFlightFetches.delete(key);
    });

  inFlightFetches.set(key, fetchPromise);

  try {
    const data = await fetchPromise;
    return { ...data, cached: false };
  } catch (error) {
    // 조회에 실패해도, 이전에 이 스트리머를 성공적으로 조회한 적이 있다면 그 결과를 그대로 유지합니다.
    if (cached) {
      return { ...cached.data, cached: true, lastError: error.message };
    }
    throw error;
  }
}

// 특정 스트리머의 현재 상태를 조회하는 API입니다. ?bj=아이디 또는 ?nick=닉네임 중 하나가 필요합니다.
app.get('/api/mission', async (req, res) => {
  const bj = String(req.query.bj || '').trim();
  const nick = String(req.query.nick || '').trim();

  if (!bj && !nick) {
    return res.status(400).json({
      error: 'bj 또는 nick 쿼리 파라미터가 필요합니다. 예: /api/mission?bj=whiteone325',
    });
  }

  try {
    const data = await getMissionDataCached({ bj, nick });
    res.json(data);
  } catch (error) {
    console.error(`SoopScope 조회 실패 (${bj ? `bj=${bj}` : `nick=${nick}`}):`, error.message);
    res.status(502).json({ error: `SoopScope 조회에 실패했습니다: ${error.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`서버가 실행되었습니다: http://localhost:${PORT}`);
  console.log('사용 예: http://localhost:' + PORT + '/broadcast.html?bj=아이디&goal=목표치');
});

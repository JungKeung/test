// public/app.js
// broadcast.html에서 쓰는 화면 로직입니다.
// 주소창의 ?bj=아이디 또는 ?nick=닉네임을 읽어서, 그 스트리머의 도전미션 TOP5만 조회합니다.
// (여러 스트리머가 각자 다른 주소로 동시에 이 화면을 쓸 수 있습니다)

// 서버 캐시가 30초 정도이므로, 그보다 살짝 짧게 주기적으로 다시 물어봅니다.
const POLL_INTERVAL_MS = 15000;

// 1~3위를 꾸며줄 때 사용할 메달 이모지와 CSS 클래스 이름입니다.
const RANK_DECORATIONS = {
  1: { emoji: '🥇', className: 'rank-1' },
  2: { emoji: '🥈', className: 'rank-2' },
  3: { emoji: '🥉', className: 'rank-3' },
};

const missionTitleEl = document.getElementById('missionTitle');
const missionCountEl = document.getElementById('missionCount');
const totalStarsEl = document.getElementById('totalStars');
const updatedAtEl = document.getElementById('updatedAt');
const rankingListEl = document.getElementById('rankingList');
const emptyMessageEl = document.getElementById('emptyMessage');

// 주소창 쿼리스트링에서 bj/nick을 읽습니다. 예: broadcast.html?bj=whiteone325
const params = new URLSearchParams(window.location.search);
const targetBj = params.get('bj');
const targetNick = params.get('nick');

// 숫자를 1,000 처럼 천 단위 콤마로 보기 좋게 바꿔줍니다.
function formatNumber(num) {
  return num.toLocaleString('ko-KR');
}

// 시각을 "오후 9:15:32" 같은 형식으로 보기 좋게 바꿔줍니다.
function formatTime(isoString) {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleTimeString('ko-KR');
}

// 닉네임에 특수문자(<, > 등)가 들어와도 안전하게 화면에 표시하기 위한 함수입니다.
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// bj/nick이 아예 없을 때 화면에 사용법을 안내합니다.
function renderMissingParam() {
  missionTitleEl.textContent = '⚠️ 스트리머를 지정해주세요';
  missionCountEl.textContent = '-';
  totalStarsEl.textContent = '-';
  updatedAtEl.textContent = '-';
  rankingListEl.innerHTML = '';
  emptyMessageEl.hidden = false;
  emptyMessageEl.textContent = '주소 끝에 ?bj=아이디 또는 ?nick=닉네임을 추가해주세요. (예: broadcast.html?bj=whiteone325)';
}

// 직전에 그린 내용과 같으면 다시 그리지 않기 위한 비교용 문자열입니다.
let lastRenderedKey = null;

// 서버가 보내준 상태로 화면을 다시 그립니다.
function renderMission(state) {
  const key = JSON.stringify({
    hasMission: state.hasMission,
    bjNick: state.bjNick,
    missionCount: state.missionCount,
    totalStars: state.totalStars,
    topRanking: state.topRanking,
  });
  if (key === lastRenderedKey) {
    return; // 내용이 바뀌지 않았으면 다시 그리지 않습니다.
  }
  lastRenderedKey = key;

  const { hasMission, bjNick, missionCount, totalStars, topRanking, updatedAt } = state;

  missionTitleEl.textContent = `🔥 ${escapeHtml(bjNick || targetBj || targetNick)} 도전미션 별풍선 TOP5`;
  missionCountEl.textContent = formatNumber(missionCount);
  totalStarsEl.textContent = formatNumber(totalStars);
  updatedAtEl.textContent = formatTime(updatedAt);

  if (!hasMission) {
    rankingListEl.innerHTML = '';
    emptyMessageEl.textContent = '현재 진행 중인 도전미션이 없습니다.';
    emptyMessageEl.hidden = false;
    return;
  }

  emptyMessageEl.hidden = true;
  rankingListEl.innerHTML = '';

  topRanking.slice(0, 5).forEach((donor) => {
    const rank = donor.rank;
    const decoration = RANK_DECORATIONS[rank];

    const li = document.createElement('li');
    li.className = 'rank-item' + (decoration ? ` ${decoration.className}` : '');

    // 표시 형식: "1위 닉네임 10,000개"
    li.innerHTML = `
      <span class="rank-number">${decoration ? `${decoration.emoji} ` : ''}${rank}위</span>
      <span class="rank-nickname">${escapeHtml(donor.nickname)}</span>
      <span class="rank-count">${formatNumber(donor.stars)}개</span>
    `;

    rankingListEl.appendChild(li);
  });
}

function buildMissionUrl() {
  const qs = new URLSearchParams();
  if (targetBj) qs.set('bj', targetBj);
  else if (targetNick) qs.set('nick', targetNick);
  return `/api/mission?${qs.toString()}`;
}

async function fetchMission() {
  try {
    const res = await fetch(buildMissionUrl());
    const data = await res.json();
    if (!res.ok) {
      console.error('조회 실패:', data.error);
      return; // 실패하면 화면은 이전 상태 그대로 둡니다.
    }
    renderMission(data);
  } catch (error) {
    console.error('네트워크 오류로 조회하지 못했습니다:', error);
  }
}

// ---- 페이지가 열리면 실행되는 초기화 코드 ----
if (!targetBj && !targetNick) {
  renderMissingParam();
} else {
  fetchMission();
  setInterval(fetchMission, POLL_INTERVAL_MS);
}

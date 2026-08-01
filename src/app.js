import {
  createTournament,
  finalizeCurrentRound,
  getCurrentRound,
  getStandings,
  selectWinner,
  tournamentIsComplete,
  undoLastSettlement,
  updateGameScore,
} from "./swiss.js";
import {
  buildResultsCsv,
  getFinalPlacements,
  getKnockoutBracket,
  getPerformanceStats,
  getScoringLeaders,
  recordText,
  scoreText,
  signedNumber,
} from "./results.js";
import { parseRosterText } from "./roster.js";

const STORAGE_KEY = "zoo-swiss-tournament-v2";
const QUICK_SCORES = [11, 15, 21, 25, 31];
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const importButton = document.querySelector("#import-button");
const importFile = document.querySelector("#import-file");
const exportButton = document.querySelector("#export-button");

let tournament = loadTournament();
let openScoreMatchId = null;

render();

importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", importTournament);
exportButton.addEventListener("click", openExportMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeExportMenu();
});

function render() {
  exportButton.hidden = !tournament;
  if (!tournament) {
    renderSetup();
    return;
  }
  renderTournament();
}

function renderSetup() {
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow"><span></span> <b id="setup-mode-label">16 参赛单位 · 晋级瑞士轮 + 单败淘汰赛</b></div>
      <h1>球场边也能<br /><em>单手完成录分。</em></h1>
      <p>
        适用于单打、双打组合和团体赛。可选择 8 或 16 个参赛单位，
        通过瑞士轮排种或晋级，再进入八强单败淘汰赛。
      </p>
      <div class="hero-stats">
        <div><strong id="setup-entrant-stat">16</strong><span>参赛单位</span></div>
        <div><strong id="setup-round-stat">5</strong><span id="setup-round-label">最多瑞士轮</span></div>
        <div><strong>1</strong><span>最终冠军</span></div>
      </div>
    </section>

    <section class="setup-card">
      <div class="section-heading">
        <div>
          <span class="step">赛事设置</span>
          <h2>创建一场新比赛</h2>
        </div>
        <span class="pill">本机自动保存</span>
      </div>

      <form id="setup-form">
        <div class="form-grid">
          <label>
            <span>参赛单位数量</span>
            <select name="entrantCount" id="entrant-count">
              <option value="16">16 个单位 · 晋级瑞士轮</option>
              <option value="8">8 个单位 · 三轮排种瑞士轮</option>
            </select>
            <small>8 单位模式全员进入淘汰赛</small>
          </label>
          <label>
            <span>赛事名称</span>
            <input name="eventName" value="Zoo 羽毛球瑞士轮" required />
          </label>
          <label>
            <span>参赛类型</span>
            <select name="entrantType">
              <option value="单打">单打 · 球员</option>
              <option value="双打">双打 · 搭档组合</option>
              <option value="团体">团体 · 队伍</option>
            </select>
          </label>
          <label>
            <span>抽签种子</span>
            <input name="seed" value="${new Date().toISOString().slice(0, 10)}" required />
            <small>相同名单与种子会得到相同抽签结果</small>
          </label>
          <label>
            <span>赛事结构</span>
            <input id="setup-structure" value="3 胜晋级 / 3 负淘汰 / 8 强单败" disabled />
            <small>比分仅记录，不限制必须打到目标分</small>
          </label>
        </div>

        <div class="rules-cards">
          <article><span>普通瑞士轮</span><strong>21 分 · BO1</strong><small>一局定胜负</small></article>
          <article>
            <span id="setup-middle-rule-title">晋级/淘汰战</span>
            <strong id="setup-middle-rule-score">31 分 · BO1</strong>
            <small id="setup-middle-rule-note">生死战一局定胜负</small>
          </article>
          <article><span>八强淘汰赛</span><strong>15 分 · BO3</strong><small>每局 15 分，三局两胜</small></article>
        </div>

        <section class="bulk-roster-card" aria-labelledby="bulk-roster-title">
          <div class="bulk-roster-heading">
            <div>
              <span class="step">复制接龙</span>
              <h3 id="bulk-roster-title">粘贴报名名单，自动识别</h3>
            </div>
            <span class="bulk-roster-count" id="bulk-roster-count">0 / 16</span>
          </div>
          <p>
            支持“1、姓名”“2. 姓名”或每行一个参赛单位；双打组合写在同一行。
          </p>
          <textarea
            id="bulk-roster-input"
            rows="8"
            placeholder="接龙示例：&#10;1、林丹&#10;2、何冰娇&#10;3、安赛龙&#10;4、李宗伟"
          ></textarea>
          <div class="bulk-roster-actions">
            <button class="button button-ghost" id="bulk-roster-clear" type="button">清空</button>
            <button class="button button-ghost" id="bulk-roster-clipboard" type="button">从剪贴板粘贴</button>
            <button class="button button-primary" id="bulk-roster-apply" type="button">识别并填入名单</button>
          </div>
          <div class="bulk-roster-status" id="bulk-roster-status" role="status" aria-live="polite">
            粘贴接龙内容后，将自动填入下面的参赛名单
          </div>
        </section>

        <fieldset class="entrant-fieldset">
          <legend>
            <span id="entrant-list-title">参赛名单 · 16 个单位</span>
            <small>俱乐部/小组可留空；填写后首轮自动回避同组</small>
          </legend>
          <div class="entrant-grid entrant-grid-detailed">
            ${Array.from({ length: 16 }, (_, index) => `
              <div class="entrant-row" data-entrant-index="${index}">
                <span class="entrant-number">${String(index + 1).padStart(2, "0")}</span>
                <label>
                  <span class="sr-only">参赛单位 ${index + 1}</span>
                  <input name="entrantName" value="参赛单位 ${index + 1}" required />
                </label>
                <label>
                  <span class="sr-only">俱乐部或小组 ${index + 1}</span>
                  <input name="affiliation" placeholder="俱乐部/小组（可选）" />
                </label>
              </div>
            `).join("")}
          </div>
        </fieldset>

        <button class="button button-primary button-wide setup-submit" type="submit">
          生成第一轮对阵 <span aria-hidden="true">→</span>
        </button>
      </form>
    </section>

    <section class="rules-strip">
      <article><span>01</span><div><strong>首轮回避</strong><p>尽量避免同俱乐部或同小组相遇。</p></div></article>
      <article><span>02</span><div><strong>同战绩抽签</strong><p>第二轮起同战绩优先且不重复交手。</p></div></article>
      <article><span>03</span><div><strong id="setup-bracket-rule-title">八强抽签</strong><p id="setup-bracket-rule-note">两支 3-0 单位分别对阵 3-2 单位。</p></div></article>
    </section>
  `;

  const entrantCountSelect = document.querySelector("#entrant-count");
  entrantCountSelect.addEventListener("change", () =>
    updateSetupMode(Number(entrantCountSelect.value)),
  );
  updateSetupMode(Number(entrantCountSelect.value));
  bindBulkRosterControls();

  document.querySelector("#setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      tournament = createTournament({
        entrantCount: Number(data.get("entrantCount")),
        eventName: data.get("eventName"),
        entrantType: data.get("entrantType"),
        seed: data.get("seed"),
        names: data.getAll("entrantName"),
        affiliations: data.getAll("affiliation"),
      });
      persist();
      render();
      showToast("第一轮对阵已生成");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function updateSetupMode(entrantCount) {
  const eightUnitMode = entrantCount === 8;
  document.querySelector("#setup-mode-label").textContent = eightUnitMode
    ? "8 参赛单位 · 三轮排种瑞士轮 + 单败淘汰赛"
    : "16 参赛单位 · 晋级瑞士轮 + 单败淘汰赛";
  document.querySelector("#setup-entrant-stat").textContent = entrantCount;
  document.querySelector("#setup-round-stat").textContent = eightUnitMode ? "3" : "5";
  document.querySelector("#setup-round-label").textContent = eightUnitMode
    ? "固定瑞士轮"
    : "最多瑞士轮";
  document.querySelector("#setup-structure").value = eightUnitMode
    ? "3 轮排种 / 全员晋级 / 固定种子对阵"
    : "3 胜晋级 / 3 负淘汰 / 8 强单败";
  document.querySelector("#setup-middle-rule-title").textContent = eightUnitMode
    ? "瑞士轮排种"
    : "晋级/淘汰战";
  document.querySelector("#setup-middle-rule-score").textContent = eightUnitMode
    ? "3 轮 · 21 分 BO1"
    : "31 分 · BO1";
  document.querySelector("#setup-middle-rule-note").textContent = eightUnitMode
    ? "全员完成三轮，不设生死战"
    : "生死战一局定胜负";
  document.querySelector("#entrant-list-title").textContent =
    `参赛名单 · ${entrantCount} 个单位`;
  document.querySelector("#setup-bracket-rule-title").textContent = eightUnitMode
    ? "固定种子对阵"
    : "八强抽签";
  document.querySelector("#setup-bracket-rule-note").textContent = eightUnitMode
    ? "1-8、4-5、2-7、3-6，前两号种子分居上下半区。"
    : "两支 3-0 单位分别对阵 3-2 单位。";

  document.querySelectorAll("[data-entrant-index]").forEach((row) => {
    const enabled = Number(row.dataset.entrantIndex) < entrantCount;
    row.hidden = !enabled;
    row.querySelectorAll("input").forEach((input) => {
      input.disabled = !enabled;
    });
  });

  const bulkRosterInput = document.querySelector("#bulk-roster-input");
  if (bulkRosterInput?.value.trim()) {
    applyBulkRoster(false);
  } else {
    updateBulkRosterStatus([], entrantCount);
  }
}

function bindBulkRosterControls() {
  const input = document.querySelector("#bulk-roster-input");
  const applyButton = document.querySelector("#bulk-roster-apply");
  const clipboardButton = document.querySelector("#bulk-roster-clipboard");
  const clearButton = document.querySelector("#bulk-roster-clear");

  input.addEventListener("input", () => applyBulkRoster(false));
  applyButton.addEventListener("click", () => applyBulkRoster(true));
  clearButton.addEventListener("click", () => {
    input.value = "";
    activeEntrantNameInputs().forEach((nameInput) => {
      nameInput.value = "";
    });
    updateBulkRosterStatus([], currentSetupEntrantCount());
    input.focus();
  });
  clipboardButton.addEventListener("click", async () => {
    try {
      input.value = await navigator.clipboard.readText();
      applyBulkRoster(true);
    } catch {
      input.focus();
      showToast("无法直接读取剪贴板，请长按输入框选择粘贴", true);
    }
  });
}

function applyBulkRoster(notify) {
  const names = parseRosterText(
    document.querySelector("#bulk-roster-input").value,
  );
  const entrantCount = currentSetupEntrantCount();
  const inputs = activeEntrantNameInputs();

  if (names.length > 0) {
    inputs.forEach((input, index) => {
      input.value = names[index] || "";
    });
  }
  updateBulkRosterStatus(names, entrantCount);

  if (!notify) return;
  if (names.length === 0) {
    showToast("没有识别到参赛单位，请检查接龙格式", true);
  } else if (names.length < entrantCount) {
    showToast(`已识别 ${names.length} 个，还差 ${entrantCount - names.length} 个`, true);
  } else if (names.length > entrantCount) {
    showToast(`已识别 ${names.length} 个，当前仅填入前 ${entrantCount} 个`);
  } else {
    showToast(`${entrantCount} 个参赛单位已自动填入`);
  }
}

function updateBulkRosterStatus(names, entrantCount) {
  const status = document.querySelector("#bulk-roster-status");
  const count = document.querySelector("#bulk-roster-count");
  const usedCount = Math.min(names.length, entrantCount);
  count.textContent = `${usedCount} / ${entrantCount}`;
  count.classList.toggle("is-ready", names.length === entrantCount);
  status.classList.toggle("is-ready", names.length === entrantCount);
  status.classList.toggle("has-warning", names.length > entrantCount);

  if (names.length === 0) {
    status.textContent = "粘贴接龙内容后，将自动填入下面的参赛名单";
  } else if (names.length < entrantCount) {
    status.textContent = `已识别 ${names.length} 个参赛单位，还需要补充 ${entrantCount - names.length} 个`;
  } else if (names.length > entrantCount) {
    status.textContent = `共识别 ${names.length} 个，当前模式只使用前 ${entrantCount} 个`;
  } else {
    status.textContent = `识别完成：${entrantCount} 个参赛单位已经填入，可继续逐项修改`;
  }
}

function currentSetupEntrantCount() {
  return Number(document.querySelector("#entrant-count").value);
}

function activeEntrantNameInputs() {
  return [...document.querySelectorAll('[data-entrant-index]:not([hidden]) input[name="entrantName"]')];
}

function renderTournament() {
  const currentRound = getCurrentRound(tournament);
  const complete = tournamentIsComplete(tournament);
  const standings = getStandings(tournament);
  const participantMap = new Map(
    tournament.participants.map((participant) => [participant.id, participant]),
  );
  const qualifiedCount = tournament.participants.filter(
    (participant) => participant.status === "qualified",
  ).length;
  const eliminatedCount = tournament.participants.filter(
    (participant) => participant.status === "eliminated",
  ).length;
  const completedMatchCount = allRounds(tournament).reduce(
    (sum, round) => sum + round.matches.filter((match) => match.winnerId).length,
    0,
  );

  app.innerHTML = `
    <section class="event-shell">
      <div class="event-topline">
        <div>
          <div class="eyebrow"><span></span> ${escapeHtml(tournament.entrantType)}赛事</div>
          <h1>${escapeHtml(tournament.eventName)}</h1>
          <p>抽签种子：${escapeHtml(tournament.seed)}</p>
        </div>
        <button class="button button-danger-ghost" id="reset-button" type="button">
          新建赛事
        </button>
      </div>

      ${renderPhaseTrack()}

      ${
        complete
          ? ""
          : renderSummaryCards({
              currentRound,
              qualifiedCount,
              eliminatedCount,
              completedMatchCount,
            })
      }

      ${
        complete
          ? renderCompletion(participantMap)
          : renderCurrentRound(currentRound, participantMap)
      }

      ${renderStandings(standings)}
      ${renderHistory(participantMap)}
    </section>

    <nav class="mobile-nav" aria-label="赛事快捷导航">
      <button type="button" data-scroll-to="#current-stage"><span>●</span>录分</button>
      <button type="button" data-scroll-to="#standings"><span>≡</span>排名</button>
      <button type="button" data-scroll-to="#history"><span>↺</span>赛程</button>
      <button type="button" data-export-mobile><span>⇩</span>导出</button>
    </nav>

    ${renderExportMenu(complete)}
  `;

  bindTournamentActions(currentRound, complete);
}

function renderSummaryCards({
  currentRound,
  qualifiedCount,
  eliminatedCount,
  completedMatchCount,
}) {
  const seedingMode = tournament.config.swissMode === "seeding";
  const completedSwissRounds = tournament.rounds.filter(
    (round) => round.finalized,
  ).length;

  return `
    <div class="summary-grid">
      <article class="summary-card">
        <span>当前阶段</span>
        <strong>${escapeHtml(currentRound.name)}</strong>
        <small>${roundRuleSummary(currentRound)}</small>
      </article>
      ${
        seedingMode
          ? `
            <article class="summary-card summary-green">
              <span>瑞士轮排种</span>
              <strong>${completedSwissRounds}<i>/ ${tournament.config.maxSwissRounds}</i></strong>
              <small>全部单位完成 3 轮</small>
            </article>
            <article class="summary-card">
              <span>淘汰赛名额</span>
              <strong>8<i>/ 8</i></strong>
              <small>所有参赛单位均可晋级</small>
            </article>
          `
          : `
            <article class="summary-card summary-green">
              <span>已晋级八强</span>
              <strong>${qualifiedCount}<i>/ 8</i></strong>
              <small>瑞士轮达到 3 胜</small>
            </article>
            <article class="summary-card summary-red">
              <span>瑞士轮淘汰</span>
              <strong>${eliminatedCount}<i>/ 8</i></strong>
              <small>瑞士轮达到 3 负</small>
            </article>
          `
      }
      <article class="summary-card">
        <span>已录结果</span>
        <strong>${completedMatchCount}</strong>
        <small>比分可选，胜者必选</small>
      </article>
    </div>
  `;
}

function renderPhaseTrack() {
  const phaseIndex =
    tournament.phase === "swiss"
      ? 0
      : tournament.phase === "knockout"
        ? (tournament.knockout?.rounds.length || 1)
        : 4;
  const phases = ["瑞士轮", "八强", "半决赛", "决赛"];
  return `
    <div class="phase-track">
      ${phases
        .map(
          (phase, index) => `
            <div class="${index <= phaseIndex ? "reached" : ""} ${index === phaseIndex ? "current" : ""}">
              <span>${index + 1}</span><small>${phase}</small>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderCurrentRound(round, participantMap) {
  const completedMatches = round.matches.filter((match) => match.winnerId).length;
  const canFinalize = completedMatches === round.matches.length;
  return `
    <section class="round-section" id="current-stage">
      <div class="round-heading">
        <div>
          <span class="round-kicker">${round.type === "swiss" ? `SWISS ${String(round.number).padStart(2, "0")}` : "KNOCKOUT"}</span>
          <h2>${escapeHtml(round.name)}</h2>
          <p>已选胜者 ${completedMatches}/${round.matches.length} 场 · 比分不限制目标分</p>
        </div>
        <div class="round-heading-aside">
          ${
            round.type === "swiss"
              ? `<div class="round-records">${recordPoolLabels(round, participantMap)}</div>`
              : `<span class="knockout-badge">15 分 BO3</span>`
          }
          <button class="round-share-button" type="button" data-share-round="${roundShareKey(round)}">
            <span aria-hidden="true">↗</span> 分享本轮赛程图
          </button>
        </div>
      </div>

      ${
        round.warnings.length
          ? `<div class="warning">${round.warnings.map(escapeHtml).join(" ")}</div>`
          : ""
      }

      <div class="matches-grid">
        ${round.matches.map((match) => renderMatch(match, participantMap, round)).join("")}
      </div>

      <div class="round-actions">
        ${
          canUndo()
            ? `<button class="button button-ghost" id="undo-button" type="button">撤回上一轮</button>`
            : "<span></span>"
        }
        <button class="button button-primary" id="finalize-button" type="button" ${
          canFinalize ? "" : "disabled"
        }>
          ${canFinalize ? finalizeButtonLabel(round) : `还需选择 ${round.matches.length - completedMatches} 场胜者`}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  `;
}

function renderMatch(match, participantMap, round) {
  const a = participantMap.get(match.aId);
  const b = participantMap.get(match.bId);
  const isOpen = openScoreMatchId === match.id;
  const aSeed = displaySeed(a, round);
  const bSeed = displaySeed(b, round);
  return `
    <article class="match-card ${match.winnerId ? "has-result" : ""}">
      <div class="match-meta">
        <span>场地 ${String(match.court).padStart(2, "0")}</span>
        <strong>${escapeHtml(match.format)}</strong>
      </div>
      <button class="competitor ${match.winnerId === a.id ? "winner" : ""}" type="button"
        data-match-id="${match.id}" data-winner-id="${a.id}">
        <span class="seed">${String(aSeed).padStart(2, "0")}</span>
        <span class="competitor-name"><strong>${escapeHtml(a.name)}</strong>${a.affiliation ? `<small>${escapeHtml(a.affiliation)}</small>` : ""}</span>
        <span class="choose">${match.winnerId === a.id ? "胜者 ✓" : "选为胜者"}</span>
      </button>
      <div class="versus"><span></span>VS<span></span></div>
      <button class="competitor ${match.winnerId === b.id ? "winner" : ""}" type="button"
        data-match-id="${match.id}" data-winner-id="${b.id}">
        <span class="seed">${String(bSeed).padStart(2, "0")}</span>
        <span class="competitor-name"><strong>${escapeHtml(b.name)}</strong>${b.affiliation ? `<small>${escapeHtml(b.affiliation)}</small>` : ""}</span>
        <span class="choose">${match.winnerId === b.id ? "胜者 ✓" : "选为胜者"}</span>
      </button>
      <button class="score-toggle" type="button" data-toggle-score="${match.id}">
        <span>${scoreSummary(match)}</span>
        <strong>${isOpen ? "收起比分" : "录入比分"}</strong>
      </button>
      ${isOpen ? renderScoreEditor(match, a, b) : ""}
    </article>
  `;
}

function renderScoreEditor(match, a, b) {
  return `
    <div class="score-editor">
      <div class="score-editor-note">
        建议 ${match.targetPoints} 分，任意比分均可结算
      </div>
      ${match.games
        .map(
          (game, gameIndex) => `
            <section class="game-score">
              <h4>${match.bestOf === 1 ? "本场比分" : `第 ${gameIndex + 1} 局`}</h4>
              <div class="score-sides">
                ${renderScoreSide(match, game, gameIndex, "a", a)}
                <span class="score-divider">:</span>
                ${renderScoreSide(match, game, gameIndex, "b", b)}
              </div>
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderScoreSide(match, game, gameIndex, side, participant) {
  return `
    <div class="score-side">
      <strong>${escapeHtml(participant.name)}</strong>
      <div class="score-stepper">
        <button type="button" aria-label="${escapeHtml(participant.name)}减一分"
          data-score-action data-match="${match.id}" data-game="${gameIndex}" data-side="${side}" data-delta="-1">−</button>
        <input type="number" min="0" inputmode="numeric" value="${game[side]}"
          aria-label="${escapeHtml(participant.name)}比分"
          data-score-input data-match="${match.id}" data-game="${gameIndex}" data-side="${side}" />
        <button type="button" aria-label="${escapeHtml(participant.name)}加一分"
          data-score-action data-match="${match.id}" data-game="${gameIndex}" data-side="${side}" data-delta="1">+</button>
      </div>
      <div class="quick-scores">
        ${QUICK_SCORES.map(
          (score) => `
            <button type="button" class="${game[side] === score ? "selected" : ""}"
              data-score-preset data-match="${match.id}" data-game="${gameIndex}" data-side="${side}" data-value="${score}">
              ${score}
            </button>
          `,
        ).join("")}
      </div>
    </div>
  `;
}

function renderCompletion(participantMap) {
  const champion = participantMap.get(tournament.knockout.championId);
  const standings = getStandings(tournament);
  const placements = getFinalPlacements(tournament, standings);
  const performance = getPerformanceStats(tournament);
  const performanceMap = new Map(
    performance.map((item) => [item.participant.id, item]),
  );
  const championStats = performanceMap.get(champion.id);
  const runnerUp = placements.find((placement) => placement.rank === 2)?.participant;
  const runnerUpStats = performanceMap.get(runnerUp?.id);
  const semifinalists = placements.filter((placement) => placement.rank === 3);
  const scoringLeaders = getScoringLeaders(tournament);
  const bracket = getKnockoutBracket(tournament);
  const topEight = placements
    .filter((placement) => placement.rank <= 5)
    .map((placement) => ({
      ...placement,
      stats: performanceMap.get(placement.participant.id),
    }));
  const finalRound = tournament.knockout.rounds.find(
    (round) => round.stage === "final",
  );
  const finalMatch = finalRound?.matches[0];
  const finalScore = finalMatch ? scoreText(finalMatch) : "未记录";
  const matchCount = allRounds(tournament).reduce(
    (sum, round) => sum + round.matches.length,
    0,
  );

  return `
    <section class="completion" id="current-stage">
      <div class="completion-hero">
        <div class="completion-status">
          <span><i></i> 赛事已结算</span>
          <small>${tournament.rounds.length} 轮瑞士轮 · 3 轮淘汰赛 · ${matchCount} 场比赛</small>
        </div>
        <div class="champion-crown" aria-hidden="true">01</div>
        <span class="champion-label">CHAMPION · 冠军</span>
        <h2>${escapeHtml(champion.name)}</h2>
        ${champion.affiliation ? `<p class="champion-affiliation">${escapeHtml(champion.affiliation)}</p>` : ""}
        <div class="champion-records" aria-label="冠军战绩">
          <span><small>瑞士轮</small><strong>${recordText(championStats.swissWins, championStats.swissLosses)}</strong></span>
          <span><small>淘汰赛</small><strong>${recordText(championStats.knockoutWins, championStats.knockoutLosses)}</strong></span>
          <span><small>总战绩</small><strong>${recordText(championStats.totalWins, championStats.totalLosses)}</strong></span>
          <span><small>总净胜分</small><strong>${signedNumber(championStats.totalNetPoints)}</strong></span>
        </div>

        <div class="final-result">
          <div class="finalist winner">
            <small>冠军</small>
            <strong>${escapeHtml(champion.name)}</strong>
          </div>
          <div class="final-score">
            <span>决赛</span>
            <b>${escapeHtml(finalScore)}</b>
            <small>15 分 · BO3</small>
          </div>
          <div class="finalist">
            <small>亚军</small>
            <strong>${escapeHtml(runnerUp?.name || "—")}</strong>
          </div>
        </div>

        <div class="completion-primary-actions">
          <button class="button button-primary" id="completion-export" type="button">
            导出比赛结果 <span aria-hidden="true">⇩</span>
          </button>
          <button class="button button-ghost" id="completion-undo" type="button">
            修改决赛结果
          </button>
        </div>
      </div>

      <div class="final-placements">
        <div class="final-placements-heading">
          <div>
            <span class="step">FINAL HONORS</span>
            <h3>最终荣誉</h3>
          </div>
          <small>得分王仅在八强中产生，按整届赛事累计总净胜分计算</small>
        </div>
        <div class="honor-grid">
          <article class="honor-card honor-champion">
            <span class="honor-rank">1</span>
            <small>冠军</small>
            <strong>${escapeHtml(champion.name)}</strong>
            <b>总战绩 ${recordText(championStats.totalWins, championStats.totalLosses)}</b>
          </article>
          <article class="honor-card">
            <span class="honor-rank">2</span>
            <small>亚军</small>
            <strong>${escapeHtml(runnerUp?.name || "—")}</strong>
            <b>总战绩 ${recordText(runnerUpStats.totalWins, runnerUpStats.totalLosses)}</b>
          </article>
          <article class="honor-card">
            <span class="honor-rank">3</span>
            <small>季军（并列）</small>
            <div class="honor-names">
              ${semifinalists
                .map(
                  (placement) =>
                    `<span>${escapeHtml(placement.participant.name)}</span>`,
                )
                .join("")}
            </div>
            <b>无季军赛</b>
          </article>
          <article class="honor-card honor-scorer">
            <span class="honor-rank">+</span>
            <small>得分王</small>
            <div class="honor-names">
              ${scoringLeaders
                .map(
                  (item) =>
                    `<span>${escapeHtml(item.participant.name)}</span>`,
                )
                .join("")}
            </div>
            <b>总净胜分 ${signedNumber(scoringLeaders[0]?.totalNetPoints || 0)}</b>
          </article>
        </div>

        ${renderKnockoutBracket(bracket)}

        <div class="performance-board">
          <div class="performance-heading">
            <div><span class="step">TOP 8 PERFORMANCE</span><h3>八强战绩总览</h3></div>
            <div class="performance-legend">
              <span>瑞：瑞士轮</span><span>淘：淘汰赛</span><span>总：全部比赛</span>
            </div>
          </div>
          <div class="performance-table">
            ${topEight
              .map(
                ({ participant, label, stats }) => `
                  <article class="${scoringLeaders.some((item) => item.participant.id === participant.id) ? "is-scoring-leader" : ""}">
                    <div class="performance-name">
                      <strong>${escapeHtml(participant.name)}</strong>
                      <small>${escapeHtml(label)}${scoringLeaders.some((item) => item.participant.id === participant.id) ? " · 得分王" : ""}</small>
                    </div>
                    <span><small>瑞士轮</small><b>${recordText(stats.swissWins, stats.swissLosses)}</b></span>
                    <span><small>淘汰赛</small><b>${recordText(stats.knockoutWins, stats.knockoutLosses)}</b></span>
                    <span><small>总战绩</small><b>${recordText(stats.totalWins, stats.totalLosses)}</b></span>
                    <span class="net-stat"><small>净胜分</small><b>${signedNumber(stats.totalNetPoints)}</b></span>
                  </article>
                `,
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderKnockoutBracket(bracket) {
  if (!bracket) return "";

  const renderLevel = (className, entries, label, hasChildren = true) => `
    <div class="knockout-bracket-level ${className}">
      ${entries
        .map(({ participant, seed, score }) => {
          const championPath = participant.id === bracket.championId;
          return `
            <div class="knockout-bracket-slot ${championPath ? "is-champion-path" : ""}">
              <article class="knockout-bracket-node">
                <small>${label}</small>
                <strong>${escapeHtml(participant.name)}</strong>
                <span>${score ? escapeHtml(score) : `种子 #${String(seed).padStart(2, "0")}`}</span>
              </article>
              ${hasChildren ? '<i class="knockout-bracket-fork" aria-hidden="true"></i>' : ""}
            </div>
          `;
        })
        .join("")}
    </div>
  `;

  return `
    <section class="knockout-bracket-board">
      <div class="knockout-bracket-heading">
        <div>
          <span class="step">TOP 8 BRACKET</span>
          <h3>八强晋级路线</h3>
        </div>
        <small>荧光绿为冠军晋级路径 · 左右滑动查看完整对阵</small>
      </div>
      <div class="knockout-bracket-scroll" tabindex="0" aria-label="八强淘汰赛晋级路线图">
        <div class="knockout-bracket-tree">
          ${renderLevel("level-champion", [bracket.champion], "冠军")}
          ${renderLevel("level-finalists", bracket.finalists, "决赛")}
          ${renderLevel("level-semifinalists", bracket.semifinalists, "四强")}
          ${renderLevel("level-quarterfinalists", bracket.quarterfinalists, "八强", false)}
        </div>
      </div>
    </section>
  `;
}

function renderExportMenu(complete) {
  return `
    <div class="export-backdrop" id="export-menu" hidden>
      <section class="export-sheet" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div class="export-sheet-handle" aria-hidden="true"></div>
        <div class="export-sheet-heading">
          <div>
            <span class="step">EXPORT RESULTS</span>
            <h2 id="export-title">导出比赛结果</h2>
          </div>
          <button class="export-close" type="button" data-export-close aria-label="关闭">×</button>
        </div>
        <p class="export-intro">
          长图适合发群和朋友圈；表格适合用 Excel 或 WPS 保存、打印和统计。
        </p>
        <div class="export-options">
          <button type="button" data-export-format="image">
            <span class="export-icon">▤</span>
            <span><strong>长图结果</strong><small>PNG 图片 · 手机分享最方便</small></span>
            <b>→</b>
          </button>
          <button type="button" data-export-format="table">
            <span class="export-icon">▦</span>
            <span><strong>表格结果</strong><small>CSV 表格 · Excel / WPS 可打开</small></span>
            <b>→</b>
          </button>
        </div>
        ${
          complete
            ? `<div class="export-ready"><span>✓</span> 已包含八强晋级图、四项荣誉、三类战绩、净胜分和完整赛果</div>`
            : `<div class="export-ready export-ready-progress"><span>!</span> 赛事尚未结束，将导出当前进度</div>`
        }
        <button class="archive-export" type="button" data-export-format="archive">
          导出赛事数据备份（JSON，可用于恢复比赛）
        </button>
      </section>
    </div>
  `;
}

function renderStandings(standings) {
  const rows = standings
    .map(
      (participant, index) => `
        <tr>
          <td><span class="rank">${index + 1}</span></td>
          <td><strong>${escapeHtml(participant.name)}</strong>${participant.affiliation ? `<small>${escapeHtml(participant.affiliation)}</small>` : ""}</td>
          <td><span class="record">${participant.wins} - ${participant.losses}</span></td>
          <td><span class="net-points">${signedNumber(participant.netPoints)}</span></td>
          <td>${statusBadge(participant.status)}</td>
        </tr>
      `,
    )
    .join("");
  const cards = standings
    .map(
      (participant, index) => `
        <article>
          <span class="rank">${index + 1}</span>
          <div><strong>${escapeHtml(participant.name)}</strong><small>${
            participant.affiliation
              ? escapeHtml(participant.affiliation)
              : tournament.config.swissMode === "seeding"
                ? `当前种子 #${index + 1}`
                : `初始顺位 #${participant.seed}`
          }</small></div>
          <b>${participant.wins}-${participant.losses}</b>
          <span class="net-points">净 ${signedNumber(participant.netPoints)}</span>
          ${statusBadge(participant.status)}
        </article>
      `,
    )
    .join("");

  return `
    <section class="standings-section" id="standings">
      <div class="section-heading">
        <div><span class="step">瑞士轮榜单</span><h2>参赛单位排名</h2></div>
        <span class="pill">${
          tournament.config.swissMode === "seeding"
            ? "胜场优先 · 同胜场按净胜分"
            : "同战绩按净胜分排序"
        }</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>排名</th><th>参赛单位</th><th>瑞士轮战绩</th><th>净胜分</th><th>状态</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="standings-cards">${cards}</div>
    </section>
  `;
}

function renderHistory(participantMap) {
  return `
    <section class="history-section" id="history">
      <div class="section-heading">
        <div><span class="step">赛事记录</span><h2>完整赛程</h2></div>
      </div>
      <div class="history-list">
        ${allRounds(tournament)
          .map((round) => renderHistoryRound(round, participantMap))
          .join("")}
      </div>
    </section>
  `;
}

function renderHistoryRound(round, participantMap) {
  return `
    <details ${round === getCurrentRound(tournament) ? "open" : ""}>
      <summary>
        <span>${escapeHtml(round.name)}</span>
        <strong>${roundRuleSummary(round)}</strong>
        <small>${round.finalized ? "已结算" : "进行中"}</small>
      </summary>
      <div class="history-matches">
        ${round.matches
          .map((match) => {
            const a = participantMap.get(match.aId);
            const b = participantMap.get(match.bId);
            return `
              <div>
                <span class="${match.winnerId === a.id ? "history-winner" : ""}">${escapeHtml(a.name)}</span>
                <b>${scoreSummary(match, true)}</b>
                <span class="${match.winnerId === b.id ? "history-winner" : ""}">${escapeHtml(b.name)}</span>
              </div>
            `;
          })
          .join("")}
      </div>
      <div class="history-share-bar">
        <span>${round.finalized ? "已完成赛段，可再次分享" : "当前赛段，分享最新对阵与结果"}</span>
        <button type="button" data-share-round="${roundShareKey(round)}">
          <span aria-hidden="true">↗</span> 生成本轮赛程图
        </button>
      </div>
    </details>
  `;
}

function bindTournamentActions(currentRound, complete) {
  document.querySelectorAll("[data-match-id]").forEach((button) => {
    button.addEventListener("click", () => {
      try {
        selectWinner(tournament, button.dataset.matchId, button.dataset.winnerId);
        persist();
        render();
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });

  document.querySelectorAll("[data-toggle-score]").forEach((button) => {
    button.addEventListener("click", () => {
      openScoreMatchId =
        openScoreMatchId === button.dataset.toggleScore
          ? null
          : button.dataset.toggleScore;
      render();
      if (openScoreMatchId) {
        document
          .querySelector(`[data-toggle-score="${openScoreMatchId}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  });

  document.querySelectorAll("[data-score-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const match = currentRound.matches.find(
        (item) => item.id === button.dataset.match,
      );
      const gameIndex = Number(button.dataset.game);
      const currentValue = match.games[gameIndex][button.dataset.side];
      setScoreFromControl(
        button,
        currentValue + Number(button.dataset.delta),
      );
    });
  });

  document.querySelectorAll("[data-score-preset]").forEach((button) => {
    button.addEventListener("click", () =>
      setScoreFromControl(button, Number(button.dataset.value)),
    );
  });

  document.querySelectorAll("[data-score-input]").forEach((input) => {
    input.addEventListener("change", () =>
      setScoreFromControl(input, input.value),
    );
  });

  document.querySelector("#finalize-button")?.addEventListener("click", () => {
    try {
      const oldPhase = tournament.phase;
      finalizeCurrentRound(tournament);
      openScoreMatchId = null;
      persist();
      render();
      showToast(
        tournamentIsComplete(tournament)
          ? "赛事完成，冠军已经产生"
          : oldPhase !== tournament.phase
            ? "瑞士轮结束，八强对阵已生成"
            : `${currentRound.name}已结算`,
      );
      document
        .querySelector("#current-stage")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.querySelector("#undo-button")?.addEventListener("click", () => {
    if (!window.confirm("撤回后可修改上一轮胜者和比分，确定继续吗？")) return;
    try {
      undoLastSettlement(tournament);
      openScoreMatchId = null;
      persist();
      render();
      showToast("已撤回上一轮结算");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.querySelector("#reset-button").addEventListener("click", () => {
    if (!window.confirm("建议先导出存档。确定移除当前赛事并新建吗？")) return;
    tournament = null;
    openScoreMatchId = null;
    localStorage.removeItem(STORAGE_KEY);
    render();
    showToast("已创建新的空白赛事");
  });

  document.querySelector("#completion-export")?.addEventListener("click", openExportMenu);
  document.querySelector("#completion-undo")?.addEventListener("click", () => {
    if (!window.confirm("返回决赛录分后，可以重新选择胜者或修改比分。确定继续吗？")) return;
    try {
      undoLastSettlement(tournament);
      persist();
      render();
      showToast("已返回决赛录分");
    } catch (error) {
      showToast(error.message, true);
    }
  });
  document.querySelector("[data-export-mobile]")?.addEventListener("click", openExportMenu);
  document.querySelectorAll("[data-share-round]").forEach((button) => {
    button.addEventListener("click", async () => {
      const round = allRounds(tournament).find(
        (item) => roundShareKey(item) === button.dataset.shareRound,
      );
      if (!round) {
        showToast("没有找到这个赛段", true);
        return;
      }
      button.disabled = true;
      try {
        await exportRoundScheduleImage(round);
      } catch (error) {
        showToast(`生成失败：${error.message}`, true);
      } finally {
        button.disabled = false;
      }
    });
  });
  document.querySelector("[data-export-close]")?.addEventListener("click", closeExportMenu);
  document.querySelector("#export-menu")?.addEventListener("click", (event) => {
    if (event.target.id === "export-menu") closeExportMenu();
  });
  document.querySelectorAll("[data-export-format]").forEach((button) => {
    button.addEventListener("click", async () => {
      const format = button.dataset.exportFormat;
      button.disabled = true;
      try {
        if (format === "image") await exportResultsImage();
        if (format === "table") await exportResultsTable();
        if (format === "archive") exportTournamentArchive();
      } catch (error) {
        showToast(`导出失败：${error.message}`, true);
      } finally {
        button.disabled = false;
      }
    });
  });
  document.querySelectorAll("[data-scroll-to]").forEach((button) => {
    button.addEventListener("click", () =>
      document
        .querySelector(button.dataset.scrollTo)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  });
}

function setScoreFromControl(control, value) {
  try {
    updateGameScore(
      tournament,
      control.dataset.match,
      Number(control.dataset.game),
      control.dataset.side,
      value,
    );
    persist();
    render();
  } catch (error) {
    showToast(error.message, true);
  }
}

function scoreSummary(match, compact = false) {
  const playedGames = match.games.filter((game) => game.a !== 0 || game.b !== 0);
  if (playedGames.length === 0) return compact ? "VS" : "尚未录入比分";
  if (match.bestOf === 1) return `${playedGames[0].a}–${playedGames[0].b}`;
  return playedGames
    .map((game, index) => `${compact ? "" : `第${index + 1}局 `}${game.a}–${game.b}`)
    .join(compact ? " / " : " · ");
}

function roundRuleSummary(round) {
  const formats = [...new Set(round.matches.map((match) => match.format))];
  return formats.join(" / ");
}

function finalizeButtonLabel(round) {
  if (round.stage === "final") return "确认结果并产生冠军";
  if (round.stage === "semifinal") return "确认结果并生成决赛";
  if (round.stage === "quarterfinal") return "确认结果并生成半决赛";
  if (
    round.type === "swiss" &&
    round.number === tournament.config.maxSwissRounds
  ) {
    return tournament.config.swissMode === "seeding"
      ? "确认排种并生成固定八强对阵"
      : "确认结果并生成八强对阵";
  }
  return "确认结果并生成下一轮";
}

function canUndo() {
  return (
    tournament.rounds.length > 1 ||
    tournament.phase !== "swiss" ||
    (tournament.rounds.at(-1)?.finalized ?? false)
  );
}

function allRounds(value) {
  return [...value.rounds, ...(value.knockout?.rounds || [])];
}

function roundShareKey(round) {
  return round.type === "swiss"
    ? `swiss-${round.number}`
    : `knockout-${round.stage || round.number}`;
}

function recordPoolLabels(round, participantMap) {
  const records = [
    ...new Set(
      round.matches.flatMap((match) =>
        [match.aId, match.bId].map((id) => {
          const participant = participantMap.get(id);
          return `${participant.wins}-${participant.losses}`;
        }),
      ),
    ),
  ];
  return records.map((record) => `<span>${record}</span>`).join("");
}

function displaySeed(participant, round) {
  if (round.type !== "knockout") return participant.seed;
  const index = tournament.knockout?.seedOrder?.indexOf(participant.id) ?? -1;
  return index >= 0 ? index + 1 : participant.seed;
}

function statusBadge(status) {
  const labels = {
    active:
      tournament.config.swissMode === "seeding" ? "排种中" : "比赛中",
    qualified: "已晋级",
    eliminated: "已淘汰",
  };
  return `<span class="status status-${status}">${labels[status]}</span>`;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tournament));
}

function loadTournament() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed.version !== 2) throw new Error("Old data");
    return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

async function importTournament() {
  const [file] = importFile.files;
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    validateImport(imported);
    tournament = imported;
    persist();
    render();
    showToast("赛事存档已导入");
  } catch (error) {
    showToast(`导入失败：${error.message}`, true);
  } finally {
    importFile.value = "";
  }
}

function validateImport(imported) {
  if (
    imported?.version !== 2 ||
    !Array.isArray(imported.participants) ||
    ![8, 16].includes(imported.participants.length) ||
    !Array.isArray(imported.rounds)
  ) {
    throw new Error("不是有效的 Zoo v2 赛事存档");
  }
}

function openExportMenu() {
  if (!tournament) return;
  const menu = document.querySelector("#export-menu");
  if (!menu) return;
  menu.hidden = false;
  document.body.classList.add("modal-open");
  menu.querySelector("[data-export-format]")?.focus();
}

function closeExportMenu() {
  const menu = document.querySelector("#export-menu");
  if (!menu) return;
  menu.hidden = true;
  document.body.classList.remove("modal-open");
}

async function exportResultsTable() {
  if (!tournament) return;
  const standings = getStandings(tournament);
  const csv = buildResultsCsv(tournament, standings);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  closeExportMenu();
  await shareOrDownload(
    blob,
    `${safeFilename(tournament.eventName)}-比赛结果.csv`,
    `${tournament.eventName}比赛结果`,
  );
  showToast("比赛结果表格已导出");
}

async function exportResultsImage() {
  if (!tournament) return;
  showToast("正在生成比赛结果长图…");
  const canvas = buildResultsCanvas(tournament, getStandings(tournament));
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("无法生成图片"))),
      "image/png",
      0.96,
    );
  });
  closeExportMenu();
  await shareOrDownload(
    blob,
    `${safeFilename(tournament.eventName)}-比赛结果.png`,
    `${tournament.eventName}比赛结果`,
  );
  showToast("比赛结果长图已导出");
}

async function exportRoundScheduleImage(round) {
  if (!tournament || !round) return;
  showToast(`正在生成${round.name}赛程图…`);
  const canvas = buildRoundScheduleCanvas(tournament, round);
  const blob = await canvasToBlob(canvas);
  await shareOrDownload(
    blob,
    `${safeFilename(tournament.eventName)}-${safeFilename(round.name)}-赛程图.png`,
    `${tournament.eventName} · ${round.name}赛程`,
  );
  showToast(`${round.name}赛程图已生成`);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("无法生成图片"))),
      "image/png",
      0.96,
    );
  });
}

function exportTournamentArchive() {
  if (!tournament) return;
  const blob = new Blob([JSON.stringify(tournament, null, 2)], {
    type: "application/json",
  });
  closeExportMenu();
  downloadBlob(
    blob,
    `${safeFilename(tournament.eventName)}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`,
  );
  showToast("赛事数据备份已导出");
}

async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function buildRoundScheduleCanvas(value, round) {
  const width = 1080;
  const margin = 64;
  const cardHeight = 190;
  const cardGap = 18;
  const headerHeight = 390;
  const footerHeight = 126;
  const height =
    headerHeight +
    round.matches.length * cardHeight +
    Math.max(0, round.matches.length - 1) * cardGap +
    footerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const participantMap = new Map(
    value.participants.map((participant) => [participant.id, participant]),
  );
  const completedMatches = round.matches.filter((match) => match.winnerId).length;
  const phaseLabel = round.type === "swiss" ? "SWISS STAGE · 瑞士轮" : "KNOCKOUT · 淘汰赛";

  context.fillStyle = "#080b0f";
  context.fillRect(0, 0, width, height);
  const topGlow = context.createRadialGradient(width - 50, 0, 20, width - 50, 0, 720);
  topGlow.addColorStop(0, "rgba(200,255,71,0.22)");
  topGlow.addColorStop(1, "rgba(200,255,71,0)");
  context.fillStyle = topGlow;
  context.fillRect(0, 0, width, 760);

  context.fillStyle = "#c8ff47";
  context.font = '900 32px "Microsoft YaHei", sans-serif';
  context.fillText("ZOO", margin, 78);
  context.fillStyle = "#7e8981";
  context.font = '700 21px "Microsoft YaHei", sans-serif';
  context.fillText("BADMINTON CLUB · 赛程分享", margin + 100, 78);

  context.fillStyle = "#9ca69f";
  context.font = '800 19px "Microsoft YaHei", sans-serif';
  context.fillText(phaseLabel, margin, 140);
  context.fillStyle = "#f5f7f3";
  context.font = '900 52px "Microsoft YaHei", sans-serif';
  drawCanvasText(context, value.eventName, margin, 205, width - margin * 2, 58);
  context.fillStyle = "#c8ff47";
  context.font = '900 38px "Microsoft YaHei", sans-serif';
  context.fillText(round.name, margin, 266);

  roundedRect(context, margin, 300, width - margin * 2, 62, 18, "#11180f");
  context.fillStyle = "#98a29a";
  context.font = '700 18px "Microsoft YaHei", sans-serif';
  context.fillText(`${value.entrantType} · ${round.matches.length} 场对阵`, margin + 24, 339);
  context.textAlign = "center";
  context.fillStyle = "#f5f7f3";
  context.fillText(roundRuleSummary(round), width / 2, 339);
  context.textAlign = "right";
  context.fillStyle = completedMatches === round.matches.length ? "#c8ff47" : "#ffd166";
  context.fillText(`已完成 ${completedMatches}/${round.matches.length}`, width - margin - 24, 339);
  context.textAlign = "left";

  let y = headerHeight;
  round.matches.forEach((match, index) => {
    const a = participantMap.get(match.aId);
    const b = participantMap.get(match.bId);
    const completed = Boolean(match.winnerId);
    const aWon = match.winnerId === a?.id;
    const bWon = match.winnerId === b?.id;
    const cardFill = completed ? "#11190f" : "#10151b";
    roundedRect(context, margin, y, width - margin * 2, cardHeight, 24, cardFill);

    context.fillStyle = "#78837b";
    context.font = '800 16px "Microsoft YaHei", sans-serif';
    context.fillText(`场地 ${String(match.court).padStart(2, "0")}`, margin + 24, y + 35);
    context.fillStyle = match.targetPoints === 31 ? "#ffd166" : "#9ca69f";
    context.fillText(match.format, margin + 128, y + 35);
    roundedRect(
      context,
      width - margin - 118,
      y + 16,
      94,
      32,
      16,
      completed ? "#26370f" : "#182129",
    );
    context.fillStyle = completed ? "#c8ff47" : "#88938b";
    context.font = '800 14px "Microsoft YaHei", sans-serif';
    context.textAlign = "center";
    context.fillText(completed ? "已完赛" : "待比赛", width - margin - 71, y + 38);

    drawScheduleParticipant(
      context,
      a,
      displaySeedForShare(value, a, round),
      margin + 34,
      y + 78,
      360,
      aWon,
      "left",
    );
    drawScheduleParticipant(
      context,
      b,
      displaySeedForShare(value, b, round),
      width - margin - 34,
      y + 78,
      360,
      bWon,
      "right",
    );

    context.textAlign = "center";
    context.fillStyle = completed ? "#c8ff47" : "#57625a";
    context.font = '900 21px Georgia, serif';
    context.fillText(completed ? scoreText(match) : "VS", width / 2, y + 113);
    if (completed) {
      const winner = participantMap.get(match.winnerId);
      context.fillStyle = "#879188";
      context.font = '700 14px "Microsoft YaHei", sans-serif';
      context.fillText(`胜者 · ${winner?.name || "—"}`, width / 2, y + 146);
    } else {
      context.strokeStyle = "#2a3430";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(width / 2 - 54, y + 137);
      context.lineTo(width / 2 + 54, y + 137);
      context.stroke();
    }
    context.textAlign = "left";
    y += cardHeight + cardGap;
  });

  y += 28;
  context.fillStyle = "#68736b";
  context.font = '600 16px "Microsoft YaHei", sans-serif';
  context.fillText("荧光绿表示已确认胜者 · 具体场地与开赛顺序以现场安排为准", margin, y + 30);
  context.textAlign = "right";
  context.fillStyle = "#c8ff47";
  context.font = '800 17px "Microsoft YaHei", sans-serif';
  context.fillText("colname.github.io/Zoo/", width - margin, y + 30);
  context.textAlign = "left";
  return canvas;
}

function drawScheduleParticipant(context, participant, seed, x, y, maxWidth, winner, align) {
  const direction = align === "right" ? -1 : 1;
  context.textAlign = align;
  context.fillStyle = winner ? "#c8ff47" : "#f5f7f3";
  context.font = `${winner ? "900" : "800"} 30px "Microsoft YaHei", sans-serif`;
  drawCanvasText(context, participant?.name || "—", x, y + 29, maxWidth, 34);
  context.fillStyle = winner ? "#a9d83f" : "#6f7a72";
  context.font = '700 15px "Microsoft YaHei", sans-serif';
  const affiliation = participant?.affiliation ? ` · ${participant.affiliation}` : "";
  drawCanvasText(
    context,
    `#${String(seed).padStart(2, "0")}${affiliation}`,
    x,
    y + 61,
    maxWidth,
    20,
  );
  if (winner) {
    context.fillStyle = "#c8ff47";
    context.beginPath();
    context.arc(x + direction * 12, y + 84, 4, 0, Math.PI * 2);
    context.fill();
  }
  context.textAlign = "left";
}

function displaySeedForShare(value, participant, round) {
  if (round.type !== "knockout") return participant?.seed || 0;
  const index = value.knockout?.seedOrder?.indexOf(participant?.id) ?? -1;
  return index >= 0 ? index + 1 : participant?.seed || 0;
}

function buildResultsCanvas(value, standings) {
  const width = 1080;
  const margin = 64;
  const rowHeight = 54;
  const rounds = allRounds(value);
  const bracket = getKnockoutBracket(value);
  const matchCount = rounds.reduce((sum, round) => sum + round.matches.length, 0);
  const height =
    370 +
    240 +
    (bracket ? 760 : 0) +
    110 +
    standings.length * rowHeight +
    120 +
    rounds.length * 64 +
    matchCount * 48 +
    100;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const participantMap = new Map(
    value.participants.map((participant) => [participant.id, participant]),
  );
  const placements = getFinalPlacements(value, standings);
  const champion = placements.find((placement) => placement.rank === 1)?.participant;
  const runnerUp = placements.find((placement) => placement.rank === 2)?.participant;
  const performanceMap = new Map(
    getPerformanceStats(value).map((item) => [item.participant.id, item]),
  );
  const scoringLeaders = getScoringLeaders(value);
  const resultRows =
    placements.length > 0
      ? placements
      : standings.map((participant, index) => ({
          participant,
          rankText: `${index + 1}`,
          label: participant.status === "qualified" ? "已晋级" : "瑞士轮",
        }));

  context.fillStyle = "#080b0f";
  context.fillRect(0, 0, width, height);
  const glow = context.createRadialGradient(width, 0, 10, width, 0, 700);
  glow.addColorStop(0, "rgba(200,255,71,0.18)");
  glow.addColorStop(1, "rgba(200,255,71,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, 700);

  let y = 76;
  context.fillStyle = "#c8ff47";
  context.font = '900 32px "Microsoft YaHei", sans-serif';
  context.fillText("ZOO", margin, y);
  context.fillStyle = "#7e8981";
  context.font = '500 22px "Microsoft YaHei", sans-serif';
  context.fillText("瑞士轮赛事结果", margin + 98, y);

  y += 78;
  context.fillStyle = "#f5f7f3";
  context.font = '900 54px "Microsoft YaHei", sans-serif';
  drawCanvasText(context, value.eventName, margin, y, width - margin * 2, 64);
  y += 82;
  context.fillStyle = "#98a29a";
  context.font = '500 22px "Microsoft YaHei", sans-serif';
  context.fillText(
    `${value.entrantType} · ${value.participants.length} 参赛单位 · ${formatDate(value.updatedAt)}`,
    margin,
    y,
  );

  y += 54;
  roundedRect(context, margin, y, width - margin * 2, 230, 28, "#11180f");
  context.fillStyle = "#c8ff47";
  context.font = '800 22px "Microsoft YaHei", sans-serif';
  context.fillText(
    value.phase === "complete" ? "TOURNAMENT CHAMPION · 冠军" : "CURRENT LEADER · 当前领先",
    margin + 36,
    y + 48,
  );
  context.fillStyle = "#f5f7f3";
  context.font = '900 56px "Microsoft YaHei", sans-serif';
  context.fillText(champion?.name || standings[0]?.name || "赛事进行中", margin + 36, y + 122);
  context.fillStyle = "#98a29a";
  context.font = '500 22px "Microsoft YaHei", sans-serif';
  context.fillText(
    champion?.affiliation || (value.phase === "complete" ? "最终冠军" : "按当前瑞士轮排名"),
    margin + 36,
    y + 164,
  );
  if (runnerUp) {
    context.fillStyle = "#68736b";
    context.font = '600 18px "Microsoft YaHei", sans-serif';
    context.fillText(
      `亚军 ${runnerUp.name}  ·  得分王 ${scoringLeaders.map((item) => item.participant.name).join("、")} ${signedNumber(scoringLeaders[0]?.totalNetPoints || 0)}`,
      margin + 36,
      y + 204,
    );
  }
  context.fillStyle = "#c8ff47";
  context.font = '900 96px Georgia, serif';
  context.textAlign = "right";
  context.fillText("01", width - margin - 34, y + 150);
  context.textAlign = "left";

  y += 286;
  if (bracket) {
    drawCanvasKnockoutBracket(context, bracket, margin, y, width - margin * 2);
    y += 730;
  }
  drawCanvasSectionTitle(
    context,
    value.phase === "complete" ? "最终名次 / 瑞士轮排名" : "当前瑞士轮排名",
    margin,
    y,
  );
  y += 48;
  for (let index = 0; index < resultRows.length; index += 1) {
    const listed = resultRows[index];
    const participant = listed.participant;
    const stats = performanceMap.get(participant.id);
    roundedRect(
      context,
      margin,
      y,
      width - margin * 2,
      rowHeight - 6,
      10,
      index % 2 === 0 ? "#10151b" : "#0c1115",
    );
    context.fillStyle = listed.rank === 1 ? "#c8ff47" : "#77827a";
    context.font = '800 20px "Microsoft YaHei", sans-serif';
    context.fillText(listed.rankText, margin + 18, y + 32);
    context.fillStyle = "#f5f7f3";
    context.font = '700 21px "Microsoft YaHei", sans-serif';
    context.fillText(participant.name, margin + 92, y + 32);
    context.fillStyle = "#7e8981";
    context.font = '500 16px "Microsoft YaHei", sans-serif';
    context.fillText(listed.label, margin + 510, y + 32);
    context.textAlign = "right";
    context.fillText(
      `瑞 ${recordText(stats.swissWins, stats.swissLosses)} · 淘 ${recordText(stats.knockoutWins, stats.knockoutLosses)} · 总 ${recordText(stats.totalWins, stats.totalLosses)} · 净 ${signedNumber(stats.totalNetPoints)}`,
      width - margin - 18,
      y + 32,
    );
    context.textAlign = "left";
    y += rowHeight;
  }

  y += 52;
  drawCanvasSectionTitle(context, "完整赛果", margin, y);
  y += 50;
  for (const round of rounds) {
    context.fillStyle = "#c8ff47";
    context.font = '800 24px "Microsoft YaHei", sans-serif';
    context.fillText(round.name, margin, y + 30);
    context.fillStyle = "#68736b";
    context.font = '500 17px "Microsoft YaHei", sans-serif';
    context.textAlign = "right";
    context.fillText(roundRuleSummary(round), width - margin, y + 30);
    context.textAlign = "left";
    y += 54;
    for (const match of round.matches) {
      const a = participantMap.get(match.aId);
      const b = participantMap.get(match.bId);
      context.fillStyle = match.winnerId === a?.id ? "#c8ff47" : "#aeb6b0";
      context.font = `${match.winnerId === a?.id ? "800" : "500"} 19px "Microsoft YaHei", sans-serif`;
      context.fillText(a?.name || "—", margin + 18, y + 29);
      context.fillStyle = "#68736b";
      context.font = '600 17px "Microsoft YaHei", sans-serif';
      context.textAlign = "center";
      context.fillText(scoreText(match), width / 2, y + 29);
      context.textAlign = "right";
      context.fillStyle = match.winnerId === b?.id ? "#c8ff47" : "#aeb6b0";
      context.font = `${match.winnerId === b?.id ? "800" : "500"} 19px "Microsoft YaHei", sans-serif`;
      context.fillText(b?.name || "—", width - margin - 18, y + 29);
      context.textAlign = "left";
      context.strokeStyle = "#202930";
      context.beginPath();
      context.moveTo(margin, y + 45);
      context.lineTo(width - margin, y + 45);
      context.stroke();
      y += 48;
    }
    y += 10;
  }

  context.fillStyle = "#68736b";
  context.font = '500 18px "Microsoft YaHei", sans-serif';
  context.fillText("由 Zoo 瑞士轮赛事程序生成", margin, height - 48);
  context.textAlign = "right";
  context.fillText("比分为赛事现场记录，允许任意分数结算", width - margin, height - 48);
  context.textAlign = "left";
  return canvas;
}

function drawCanvasKnockoutBracket(context, bracket, x, y, width) {
  drawCanvasSectionTitle(context, "八强晋级路线", x, y);
  context.fillStyle = "#6f7a72";
  context.font = '500 17px "Microsoft YaHei", sans-serif';
  context.fillText("荧光绿为冠军晋级路径", x, y + 31);

  const treeTop = y + 72;
  const nodeHeight = 72;
  const levelGap = 84;
  const levelYs = [
    treeTop,
    treeTop + nodeHeight + levelGap,
    treeTop + (nodeHeight + levelGap) * 2,
    treeTop + (nodeHeight + levelGap) * 3,
  ];
  const levels = [
    { entries: [bracket.champion], label: "冠军", width: 210 },
    { entries: bracket.finalists, label: "决赛", width: 190 },
    { entries: bracket.semifinalists, label: "四强", width: 160 },
    { entries: bracket.quarterfinalists, label: "八强", width: 100 },
  ];

  context.strokeStyle = "#425047";
  context.lineWidth = 2;
  for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
    const parents = levels[levelIndex].entries;
    const children = levels[levelIndex + 1].entries;
    const parentY = levelYs[levelIndex] + nodeHeight;
    const childY = levelYs[levelIndex + 1];
    const joinY = parentY + (childY - parentY) / 2;

    parents.forEach((parent, parentIndex) => {
      const parentX = x + ((parentIndex + 0.5) * width) / parents.length;
      const firstChildX =
        x + (((parentIndex * 2) + 0.5) * width) / children.length;
      const secondChildX =
        x + (((parentIndex * 2) + 1.5) * width) / children.length;
      const championPath = parent.participant.id === bracket.championId;

      context.strokeStyle = championPath ? "#c8ff47" : "#344039";
      context.beginPath();
      context.moveTo(parentX, parentY);
      context.lineTo(parentX, joinY);
      context.lineTo(firstChildX, joinY);
      context.moveTo(parentX, joinY);
      context.lineTo(secondChildX, joinY);
      context.lineTo(secondChildX, childY);
      context.moveTo(firstChildX, joinY);
      context.lineTo(firstChildX, childY);
      context.stroke();
    });
  }

  levels.forEach((level, levelIndex) => {
    level.entries.forEach((entry, entryIndex) => {
      const centerX = x + ((entryIndex + 0.5) * width) / level.entries.length;
      const nodeX = centerX - level.width / 2;
      const nodeY = levelYs[levelIndex];
      const championPath = entry.participant.id === bracket.championId;
      roundedRect(
        context,
        nodeX,
        nodeY,
        level.width,
        nodeHeight,
        12,
        championPath ? "#1d2a0e" : "#10151b",
      );
      context.strokeStyle = championPath ? "#7ca82e" : "#2a3530";
      context.lineWidth = 2;
      context.strokeRect(nodeX + 1, nodeY + 1, level.width - 2, nodeHeight - 2);
      context.fillStyle = championPath ? "#c8ff47" : "#77827a";
      context.font = '800 13px "Microsoft YaHei", sans-serif';
      context.textAlign = "center";
      context.fillText(level.label, centerX, nodeY + 20);
      context.fillStyle = "#f5f7f3";
      context.font = `800 ${levelIndex === 3 ? 14 : 17}px "Microsoft YaHei", sans-serif`;
      drawCanvasText(
        context,
        entry.participant.name,
        centerX,
        nodeY + 43,
        level.width - 14,
        20,
      );
      context.fillStyle = championPath ? "#a9d83f" : "#68736b";
      context.font = '600 11px "Microsoft YaHei", sans-serif';
      context.fillText(
        entry.score || `#${String(entry.seed).padStart(2, "0")}`,
        centerX,
        nodeY + 61,
      );
      context.textAlign = "left";
    });
  });
}

function drawCanvasSectionTitle(context, text, x, y) {
  context.fillStyle = "#f5f7f3";
  context.font = '900 30px "Microsoft YaHei", sans-serif';
  context.fillText(text, x, y);
}

function drawCanvasText(context, text, x, y, maxWidth, lineHeight) {
  if (context.measureText(text).width <= maxWidth) {
    context.fillText(text, x, y);
    return;
  }
  let value = text;
  while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  context.fillText(`${value}…`, x, y);
}

function roundedRect(context, x, y, width, height, radius, fillStyle) {
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
  } else {
    const corner = Math.min(radius, width / 2, height / 2);
    context.moveTo(x + corner, y);
    context.lineTo(x + width - corner, y);
    context.quadraticCurveTo(x + width, y, x + width, y + corner);
    context.lineTo(x + width, y + height - corner);
    context.quadraticCurveTo(
      x + width,
      y + height,
      x + width - corner,
      y + height,
    );
    context.lineTo(x + corner, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - corner);
    context.lineTo(x, y + corner);
    context.quadraticCurveTo(x, y, x + corner, y);
  }
  context.closePath();
  context.fillStyle = fillStyle;
  context.fill();
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN");
}

function safeFilename(value) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "zoo-tournament";
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

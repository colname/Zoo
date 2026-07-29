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
exportButton.addEventListener("click", exportTournament);

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
      <div class="eyebrow"><span></span> 16 参赛单位 · 完整瑞士轮 + 单败淘汰赛</div>
      <h1>球场边也能<br /><em>单手完成录分。</em></h1>
      <p>
        适用于单打、双打组合和团体赛。瑞士轮产生 8 个晋级单位，
        再通过四分之一决赛、半决赛和决赛决出冠军。
      </p>
      <div class="hero-stats">
        <div><strong>16</strong><span>参赛单位</span></div>
        <div><strong>5</strong><span>最多瑞士轮</span></div>
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
            <span>赛事名称</span>
            <input name="eventName" value="Zoo 羽毛球瑞士轮" required />
          </label>
          <label>
            <span>参赛类型</span>
            <select name="entrantType">
              <option value="单打">单打 · 16 名球员</option>
              <option value="双打">双打 · 16 组搭档</option>
              <option value="团体">团体 · 16 支队伍</option>
            </select>
          </label>
          <label>
            <span>抽签种子</span>
            <input name="seed" value="${new Date().toISOString().slice(0, 10)}" required />
            <small>相同名单与种子会得到相同抽签结果</small>
          </label>
          <label>
            <span>赛事结构</span>
            <input value="3 胜晋级 / 3 负淘汰 / 8 强单败" disabled />
            <small>比分仅记录，不限制必须打到目标分</small>
          </label>
        </div>

        <div class="rules-cards">
          <article><span>普通瑞士轮</span><strong>21 分 · BO1</strong><small>一局定胜负</small></article>
          <article><span>晋级/淘汰战</span><strong>31 分 · BO1</strong><small>生死战一局定胜负</small></article>
          <article><span>八强淘汰赛</span><strong>15 分 · BO3</strong><small>每局 15 分，三局两胜</small></article>
        </div>

        <fieldset class="entrant-fieldset">
          <legend>
            <span>参赛名单</span>
            <small>俱乐部/小组可留空；填写后首轮自动回避同组</small>
          </legend>
          <div class="entrant-grid entrant-grid-detailed">
            ${Array.from({ length: 16 }, (_, index) => `
              <div class="entrant-row">
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
      <article><span>03</span><div><strong>八强抽签</strong><p>两支 3-0 单位分别对阵 3-2 单位。</p></div></article>
    </section>
  `;

  document.querySelector("#setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      tournament = createTournament({
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

      <div class="summary-grid">
        <article class="summary-card">
          <span>当前阶段</span>
          <strong>${complete ? "已完赛" : escapeHtml(currentRound.name)}</strong>
          <small>${complete ? "冠军已经产生" : roundRuleSummary(currentRound)}</small>
        </article>
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
        <article class="summary-card">
          <span>已录结果</span>
          <strong>${completedMatchCount}</strong>
          <small>比分可选，胜者必选</small>
        </article>
      </div>

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
      <button type="button" data-export-mobile><span>⇩</span>存档</button>
    </nav>
  `;

  bindTournamentActions(currentRound, complete);
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
        ${
          round.type === "swiss"
            ? `<div class="round-records">${recordPoolLabels(round, participantMap)}</div>`
            : `<span class="knockout-badge">15 分 BO3</span>`
        }
      </div>

      ${
        round.warnings.length
          ? `<div class="warning">${round.warnings.map(escapeHtml).join(" ")}</div>`
          : ""
      }

      <div class="matches-grid">
        ${round.matches.map((match) => renderMatch(match, participantMap)).join("")}
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

function renderMatch(match, participantMap) {
  const a = participantMap.get(match.aId);
  const b = participantMap.get(match.bId);
  const isOpen = openScoreMatchId === match.id;
  return `
    <article class="match-card ${match.winnerId ? "has-result" : ""}">
      <div class="match-meta">
        <span>场地 ${String(match.court).padStart(2, "0")}</span>
        <strong>${escapeHtml(match.format)}</strong>
      </div>
      <button class="competitor ${match.winnerId === a.id ? "winner" : ""}" type="button"
        data-match-id="${match.id}" data-winner-id="${a.id}">
        <span class="seed">${String(a.seed).padStart(2, "0")}</span>
        <span class="competitor-name"><strong>${escapeHtml(a.name)}</strong>${a.affiliation ? `<small>${escapeHtml(a.affiliation)}</small>` : ""}</span>
        <span class="choose">${match.winnerId === a.id ? "胜者 ✓" : "选为胜者"}</span>
      </button>
      <div class="versus"><span></span>VS<span></span></div>
      <button class="competitor ${match.winnerId === b.id ? "winner" : ""}" type="button"
        data-match-id="${match.id}" data-winner-id="${b.id}">
        <span class="seed">${String(b.seed).padStart(2, "0")}</span>
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
  return `
    <section class="completion" id="current-stage">
      <div class="champion-mark">冠军</div>
      <span class="step">TOURNAMENT COMPLETE</span>
      <h2>${escapeHtml(champion.name)}</h2>
      ${champion.affiliation ? `<p>${escapeHtml(champion.affiliation)}</p>` : ""}
      <p>瑞士轮与三轮单败淘汰赛已经全部结束。</p>
      <button class="button button-primary" id="completion-export" type="button">导出最终赛事存档</button>
    </section>
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
          <td>${participant.buchholz}</td>
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
          <div><strong>${escapeHtml(participant.name)}</strong><small>${participant.affiliation ? escapeHtml(participant.affiliation) : `初始顺位 #${participant.seed}`}</small></div>
          <b>${participant.wins}-${participant.losses}</b>
          ${statusBadge(participant.status)}
        </article>
      `,
    )
    .join("");

  return `
    <section class="standings-section" id="standings">
      <div class="section-heading">
        <div><span class="step">瑞士轮榜单</span><h2>参赛单位排名</h2></div>
        <span class="pill">同战绩按对手胜场排序</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>排名</th><th>参赛单位</th><th>战绩</th><th>对手分</th><th>状态</th></tr></thead>
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

  document.querySelector("#completion-export")?.addEventListener("click", exportTournament);
  document.querySelector("[data-export-mobile]")?.addEventListener("click", exportTournament);
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
  if (round.number === 5) return "确认结果并生成八强对阵";
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

function statusBadge(status) {
  const labels = {
    active: "比赛中",
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
    imported.participants.length !== 16 ||
    !Array.isArray(imported.rounds)
  ) {
    throw new Error("不是有效的 Zoo v2 赛事存档");
  }
}

function exportTournament() {
  if (!tournament) return;
  const blob = new Blob([JSON.stringify(tournament, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilename(tournament.eventName)}-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("赛事存档已导出");
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

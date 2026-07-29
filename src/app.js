import {
  DEFAULT_ROUND_FORMATS,
  createTournament,
  finalizeCurrentRound,
  getStandings,
  selectWinner,
  tournamentIsComplete,
  undoLastSettlement,
} from "./swiss.js";

const STORAGE_KEY = "zoo-swiss-tournament-v1";
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const importButton = document.querySelector("#import-button");
const importFile = document.querySelector("#import-file");
const exportButton = document.querySelector("#export-button");

let tournament = loadTournament();

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
  const defaultNames = Array.from(
    { length: 16 },
    (_, index) => `参赛单位 ${index + 1}`,
  );

  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow"><span></span> 16 参赛单位 · 3 胜晋级 · 3 负淘汰</div>
      <h1>把复杂赛程，<br /><em>变成清晰的一轮。</em></h1>
      <p>
        为羽毛球设计的轻量瑞士轮赛事工具。参赛单位可以是一名球员、
        一组双打搭档，或一支团体队。
      </p>
      <div class="hero-stats">
        <div><strong>16</strong><span>参赛单位</span></div>
        <div><strong>5</strong><span>最多轮次</span></div>
        <div><strong>8</strong><span>最终晋级</span></div>
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
            <small>相同名单与种子会得到相同首轮对阵</small>
          </label>
          <label>
            <span>赛制说明</span>
            <input value="3 胜晋级 / 3 负淘汰" disabled />
            <small>16 人首版固定，最多进行 5 轮</small>
          </label>
        </div>

        <fieldset class="format-fieldset">
          <legend>各轮比赛形式</legend>
          <div class="format-grid">
            ${DEFAULT_ROUND_FORMATS.map(
              (format, index) => `
                <label>
                  <span>第 ${index + 1} 轮</span>
                  <select name="roundFormat">
                    <option ${format === "一局定胜负" ? "selected" : ""}>一局定胜负</option>
                    <option ${format === "三局两胜" ? "selected" : ""}>三局两胜</option>
                    <option>五局三胜</option>
                  </select>
                </label>
              `,
            ).join("")}
          </div>
        </fieldset>

        <fieldset class="entrant-fieldset">
          <legend>
            <span>参赛名单</span>
            <small>共 16 个参赛单位</small>
          </legend>
          <div class="entrant-grid">
            ${defaultNames
              .map(
                (name, index) => `
                  <label class="entrant-input">
                    <span>${String(index + 1).padStart(2, "0")}</span>
                    <input name="entrantName" value="${name}" required />
                  </label>
                `,
              )
              .join("")}
          </div>
        </fieldset>

        <button class="button button-primary button-wide" type="submit">
          生成第一轮对阵
          <span aria-hidden="true">→</span>
        </button>
      </form>
    </section>

    <section class="rules-strip">
      <article><span>01</span><div><strong>首轮抽签</strong><p>16 个参赛单位随机组成 8 场比赛。</p></div></article>
      <article><span>02</span><div><strong>同战绩配对</strong><p>后续优先在相同胜负记录内配对。</p></div></article>
      <article><span>03</span><div><strong>避免重赛</strong><p>算法优先寻找未曾交手的对手。</p></div></article>
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
        roundFormats: data.getAll("roundFormat"),
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
  const currentRound = tournament.rounds.at(-1);
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

  app.innerHTML = `
    <section class="event-shell">
      <div class="event-topline">
        <div>
          <div class="eyebrow"><span></span> ${escapeHtml(tournament.entrantType)}赛事</div>
          <h1>${escapeHtml(tournament.eventName)}</h1>
          <p>抽签种子：${escapeHtml(tournament.seed)}</p>
        </div>
        <button class="button button-danger-ghost" id="reset-button" type="button">
          结束并新建赛事
        </button>
      </div>

      <div class="summary-grid">
        <article class="summary-card">
          <span>当前进度</span>
          <strong>${complete ? "已完成" : `第 ${currentRound.number} 轮`}</strong>
          <small>${complete ? "全部 16 个参赛单位已有结果" : currentRound.format}</small>
        </article>
        <article class="summary-card summary-green">
          <span>已晋级</span>
          <strong>${qualifiedCount}<i>/ 8</i></strong>
          <small>达到 3 胜</small>
        </article>
        <article class="summary-card summary-red">
          <span>已淘汰</span>
          <strong>${eliminatedCount}<i>/ 8</i></strong>
          <small>达到 3 负</small>
        </article>
        <article class="summary-card">
          <span>进行中</span>
          <strong>${16 - qualifiedCount - eliminatedCount}</strong>
          <small>仍在瑞士轮中的单位</small>
        </article>
      </div>

      ${complete ? renderCompletion(standings) : renderCurrentRound(currentRound, participantMap)}

      <section class="standings-section">
        <div class="section-heading">
          <div>
            <span class="step">实时榜单</span>
            <h2>参赛单位排名</h2>
          </div>
          <span class="pill">同战绩按对手胜场排序</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>参赛单位</th>
                <th>战绩</th>
                <th>对手分</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              ${standings
                .map(
                  (participant, index) => `
                    <tr>
                      <td><span class="rank">${index + 1}</span></td>
                      <td><strong>${escapeHtml(participant.name)}</strong><small>#${participant.seed}</small></td>
                      <td><span class="record">${participant.wins} - ${participant.losses}</span></td>
                      <td>${participant.buchholz}</td>
                      <td>${statusBadge(participant.status)}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="history-section">
        <div class="section-heading">
          <div>
            <span class="step">赛事记录</span>
            <h2>轮次历史</h2>
          </div>
        </div>
        <div class="history-list">
          ${tournament.rounds
            .map((round) => renderHistoryRound(round, participantMap))
            .join("")}
        </div>
      </section>
    </section>
  `;

  bindTournamentActions(currentRound, complete);
}

function renderCurrentRound(round, participantMap) {
  const completedMatches = round.matches.filter((match) => match.winnerId).length;
  const canFinalize = completedMatches === round.matches.length;

  return `
    <section class="round-section">
      <div class="round-heading">
        <div>
          <span class="round-kicker">ROUND ${String(round.number).padStart(2, "0")}</span>
          <h2>第 ${round.number} 轮对阵</h2>
          <p>${escapeHtml(round.format)} · 已录入 ${completedMatches}/${round.matches.length} 场</p>
        </div>
        <div class="round-records">${recordPoolLabels(round, participantMap)}</div>
      </div>

      ${
        round.warnings.length
          ? `<div class="warning">${round.warnings.map(escapeHtml).join(" ")}</div>`
          : ""
      }

      <div class="matches-grid">
        ${round.matches
          .map((match) => renderMatch(match, participantMap))
          .join("")}
      </div>

      <div class="round-actions">
        ${
          tournament.rounds.length > 1
            ? `<button class="button button-ghost" id="undo-button" type="button">撤回上一轮结算</button>`
            : "<span></span>"
        }
        <button class="button button-primary" id="finalize-button" type="button" ${
          canFinalize ? "" : "disabled"
        }>
          ${canFinalize ? "确认结果并生成下一轮" : `还需录入 ${round.matches.length - completedMatches} 场`}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  `;
}

function renderMatch(match, participantMap) {
  const a = participantMap.get(match.aId);
  const b = participantMap.get(match.bId);
  return `
    <article class="match-card ${match.winnerId ? "has-result" : ""}">
      <div class="match-meta">
        <span>场地 ${String(match.court).padStart(2, "0")}</span>
        <span>${a.wins}-${a.losses} 战绩池</span>
      </div>
      <button
        class="competitor ${match.winnerId === a.id ? "winner" : ""}"
        type="button"
        data-match-id="${match.id}"
        data-winner-id="${a.id}"
      >
        <span class="seed">${String(a.seed).padStart(2, "0")}</span>
        <strong>${escapeHtml(a.name)}</strong>
        <span class="choose">${match.winnerId === a.id ? "胜者 ✓" : "选择胜者"}</span>
      </button>
      <div class="versus"><span></span>VS<span></span></div>
      <button
        class="competitor ${match.winnerId === b.id ? "winner" : ""}"
        type="button"
        data-match-id="${match.id}"
        data-winner-id="${b.id}"
      >
        <span class="seed">${String(b.seed).padStart(2, "0")}</span>
        <strong>${escapeHtml(b.name)}</strong>
        <span class="choose">${match.winnerId === b.id ? "胜者 ✓" : "选择胜者"}</span>
      </button>
    </article>
  `;
}

function renderCompletion(standings) {
  const qualifiers = standings.filter(
    (participant) => participant.status === "qualified",
  );
  return `
    <section class="completion">
      <div class="completion-copy">
        <span class="step">TOURNAMENT COMPLETE</span>
        <h2>瑞士轮全部结束</h2>
        <p>8 个参赛单位完成晋级。你可以导出赛事存档，保留完整对阵与结果。</p>
      </div>
      <div class="qualifier-grid">
        ${qualifiers
          .map(
            (participant, index) => `
              <div><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(participant.name)}</strong><small>${participant.wins}-${participant.losses}</small></div>
            `,
          )
          .join("")}
      </div>
      <button class="button button-primary" id="completion-export" type="button">导出最终赛事存档</button>
    </section>
  `;
}

function renderHistoryRound(round, participantMap) {
  return `
    <details ${round === tournament.rounds.at(-1) ? "open" : ""}>
      <summary>
        <span>第 ${round.number} 轮</span>
        <strong>${escapeHtml(round.format)}</strong>
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
                <b>VS</b>
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
        selectWinner(
          tournament,
          button.dataset.matchId,
          button.dataset.winnerId,
        );
        persist();
        render();
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });

  document.querySelector("#finalize-button")?.addEventListener("click", () => {
    try {
      finalizeCurrentRound(tournament);
      persist();
      render();
      showToast(
        tournamentIsComplete(tournament)
          ? "赛事已完成，8 个参赛单位晋级"
          : `第 ${currentRound.number} 轮已结算`,
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.querySelector("#undo-button")?.addEventListener("click", () => {
    if (!window.confirm("撤回后可修改上一轮胜者，确定继续吗？")) return;
    try {
      undoLastSettlement(tournament);
      persist();
      render();
      showToast("已撤回上一轮结算");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.querySelector("#reset-button").addEventListener("click", () => {
    if (!window.confirm("当前赛事将从本机移除。建议先导出存档，确定继续吗？")) {
      return;
    }
    tournament = null;
    localStorage.removeItem(STORAGE_KEY);
    render();
    showToast("已创建新的空白赛事");
  });

  if (complete) {
    document
      .querySelector("#completion-export")
      ?.addEventListener("click", exportTournament);
  }
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
    return saved ? JSON.parse(saved) : null;
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
    imported?.version !== 1 ||
    !Array.isArray(imported.participants) ||
    imported.participants.length !== 16 ||
    !Array.isArray(imported.rounds)
  ) {
    throw new Error("不是有效的 Zoo 赛事存档");
  }
}

function exportTournament() {
  if (!tournament) return;
  const body = JSON.stringify(tournament, null, 2);
  const blob = new Blob([body], { type: "application/json" });
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

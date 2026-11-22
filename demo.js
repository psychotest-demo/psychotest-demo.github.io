const sessionKey = 'xin-xing-demo-four-turns';
const sequence = ['home', 'chat', 'chat', 'chat', 'chat', 'surveyIntro', 'presence', 'post', 'background', 'done'];
const consent = {
  version: 'demo-v3',
  paragraphs: [
    '我们正在开发一款 AI 辅助心理分析产品，想了解它在对话中的回复表现。请结合自己的近况回答，分享你愿意谈的内容。',
    '建议先交流四轮，你可以继续聊，也可以随时结束对话。你发送的文字会交给 DeepSeek 生成回复，本站仅在当前浏览器会话中暂存体验进度。',
    '你可以跳过任何一轮，也可以随时退出。请勿填写姓名、学号、联系方式、具体地址或其他可识别身份的信息。AI 回复仅供体验。',
  ],
};
const suggestedRounds = 4;
const surveyIntroIndex = sequence.indexOf('surveyIntro');
const conditions = ['系统助手', '小暖'];
const session = () => JSON.parse(sessionStorage.getItem(sessionKey));
const save = state => sessionStorage.setItem(sessionKey, JSON.stringify(state));
const respond = value => ({ json: async () => value });

function chatRound(state) {
  return state.chatRound ?? Math.min(state.index, suggestedRounds);
}

function goToRound(state, round) {
  state.index = Math.min(round, suggestedRounds);
  if (round > suggestedRounds) state.chatRound = round;
  else delete state.chatRound;
}

function draftKey(state) {
  const round = chatRound(state);
  return sequence[state.index] === 'chat' && round > suggestedRounds ? 'chat-' + round : state.index;
}

function view(state) {
  if (!state || state.index === 0) return null;
  return {
    ...state, label: conditions[state.group], stage: state.exited ? 'done' : sequence[state.index],
    round: chatRound(state), draftKey: draftKey(state),
    status: state.exited ? 'exited' : state.index === sequence.length - 1 ? 'complete' : 'active',
  };
}

export function resetDemo() {
  sessionStorage.removeItem(sessionKey);
}

export function updateDraft(value) {
  const state = session();
  if (!state) return;
  state.drafts[draftKey(state)] = value;
  save(state);
}

async function getReply(state, user, fetcher, signal) {
  const history = state.rounds.slice(0, chatRound(state) - 1)
    .filter(entry => entry.status === 'sent').slice(-3)
    .map(({ user, assistant }) => ({ user, assistant }));
  const response = await fetcher('https://xin-xing-experiment-demo.vigilantcupcake4.chatgpt.site/api/reply', {
    method: 'POST',
    credentials: 'omit',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group: state.group, round: chatRound(state), user, history }),
  }).catch(() => {
    signal?.throwIfAborted();
    throw Error('暂时无法连接 AI。你的文字还在，可以稍后重试。');
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.reply !== 'string') {
    throw Error(result.error || '暂时无法收到 AI 回复，请稍后重试。');
  }
  return result.reply;
}

export async function demoRequest(path, { body, fetcher = fetch, signal } = {}) {
  signal?.throwIfAborted();
  let state = session();
  if (path === '/api/state') return respond({ mode: 'demo', consent, state: view(state) });
  if (path === '/api/start') {
    if (!body?.eligible || !body.agree || body.consentVersion !== consent.version) throw Error('请确认已阅读参与说明。');
    if (!state) {
      const group = crypto.getRandomValues(new Uint8Array(1))[0] % conditions.length;
      state = {
        id: 'DEMO-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
        group, index: 0, rounds: [], drafts: {},
      };
    }
    if (state.index === 0) state.index = 1;
  } else {
    if (!state) throw Error('请重新开始本次体验。');
    const stage = sequence[state.index];
    if (path === '/api/back') {
      if (state.exited) state.exited = false;
      else if (stage === 'surveyIntro' && state.endedFrom) {
        goToRound(state, state.endedFrom);
        delete state.endedFrom;
      } else if (stage === 'chat') goToRound(state, chatRound(state) - 1);
      else state.index = Math.max(0, state.index - 1);
    } else if (state.exited || stage === 'done') {
      throw Error('本次体验已结束。');
    } else if (path === '/api/round') {
      const round = chatRound(state);
      if (stage !== 'chat' || round !== body.round) throw Error('请刷新页面查看当前体验进度。');
      const user = body.skip ? null : String(body.text ?? '').trim();
      if (!body.skip && (!user || user.length > 420)) throw Error('请输入 1–420 字，或选择跳过本轮。');
      const existing = state.rounds[round - 1];
      if (!existing || existing.user !== user) {
        const assistant = body.skip ? null : await getReply(state, user, fetcher, signal);
        signal?.throwIfAborted();
        state.rounds.splice(round - 1, Infinity, { user, assistant, status: body.skip ? 'skipped' : 'sent', round });
        for (const key of Object.keys(state.drafts)) {
          const numericKey = Number(key);
          const dialogueKey = key.startsWith('chat-') ? Number(key.slice(5)) : numericKey;
          if (numericKey >= surveyIntroIndex || dialogueKey > round) delete state.drafts[key];
        }
      }
      goToRound(state, round + 1);
    } else if (path === '/api/dialogue/end') {
      if (stage !== 'chat') throw Error('本次对话已结束。');
      state.endedFrom = chatRound(state);
      state.index = surveyIntroIndex;
      delete state.chatRound;
    } else if (path === '/api/survey/start') {
      if (stage !== 'surveyIntro') throw Error('请先结束对话。');
      state.index += 1;
    } else if (path === '/api/survey') {
      if (stage !== body.stage || !['presence', 'post', 'background'].includes(stage)) {
        throw Error('请刷新页面查看当前体验进度。');
      }
      state.drafts[state.index] = body.answers;
      state.index += 1;
    } else if (path === '/api/exit') {
      state.exited = true;
    } else throw Error('该操作不适用于流程演示。');
  }
  save(state);
  return respond({ state: view(state) });
}

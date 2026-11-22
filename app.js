import { demoRequest, resetDemo, updateDraft } from './demo.js';
import { screens, agreement, opener } from './questions.js';

const app = document.querySelector('#app');
const exit = document.querySelector('#exit');
const previousPage = document.querySelector('#previous');
const dialog = document.querySelector('#exit-dialog');
const modeLabel = document.querySelector('#mode-label');
const achievement = document.querySelector('#achievement');
const field = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (label, className = 'primary', type = 'button') => {
  const node = field('button', label, className);
  node.type = type;
  return node;
};

let config;
let state;
let busy = false;
let pendingReply;

const request = demoRequest;

function setFeedback(target, message) {
  target.textContent = message;
}

async function submit(path, body, error, waiting, thread, signal) {
  if (busy) return;
  busy = true;
  const previous = [...app.querySelectorAll('button')]
    .filter(node => !signal || !node.classList.contains('end-dialogue'))
    .map(node => [node, node.disabled]);
  for (const [node] of previous) node.disabled = true;
  exit.disabled = true;
  previousPage.disabled = true;
  setFeedback(error, '');
  const status = thread ? messageBubble('assistant', state.label, waiting) : field('p', waiting, 'hint');
  status.setAttribute('role', 'status');
  const outgoing = thread ? messageBubble('participant', '你', body.text.trim()) : null;
  if (thread) {
    status.classList.add('message--pending');
    thread.append(outgoing, status);
    scrollToLatest(thread);
  } else {
    error.after(status);
  }
  try {
    const result = await request(path, { body: { ...body, requestId: crypto.randomUUID() }, signal });
    state = (await result.json()).state;
    if (path === '/api/back') achievement.replaceChildren();
    render(true);
    if (path === '/api/survey' && state.status === 'complete') showAchievement();
  } catch (err) {
    if (!signal?.aborted) setFeedback(error, err.message);
  } finally {
    status.remove();
    outgoing?.remove();
    for (const [node, disabled] of previous) node.disabled = disabled;
    busy = false;
    exit.disabled = false;
    previousPage.disabled = !state;
  }
}

function errorLine() {
  const error = field('div', '', 'error');
  error.setAttribute('role', 'alert');
  return error;
}

function title(text, tag = 'h1') {
  const h = field(tag, text);
  h.tabIndex = -1;
  return h;
}

function formCheck(text, name) {
  const label = field('label', '', 'check');
  const input = field('input');
  input.type = 'checkbox';
  input.name = name;
  input.required = true;
  label.append(input, field('span', text));
  return label;
}

function inputWithLabel(name, label, type = 'text') {
  const box = field('div');
  const caption = field('label', label);
  caption.htmlFor = name;
  const input = field('input');
  input.id = name;
  input.name = name;
  input.type = type;
  box.append(caption, input);
  return { box, input };
}

function consentPage() {
  const hero = field('div', '', 'hero');
  const copy = field('section', '', 'hero-copy');
  copy.append(field('p', '聊一件最近发生的小事。分享多少，由你决定。', 'intro'));
  const steps = field('ol', '', 'steps');
  for (const [label, detail] of [['开始前', '阅读参与说明'], ['文字对话', '建议先聊四轮']]) {
    const li = field('li');
    li.append(field('strong', label), field('span', detail));
    steps.append(li);
  }
  copy.append(steps);
  const panel = field('section', '', 'sheet consent');
  panel.append(title('参与说明'));
  for (const para of config.consent.paragraphs) panel.append(field('p', para));
  if (config.consent.contact) panel.append(field('p', '研究联系 ' + config.consent.contact, 'contact'));
  const form = field('form');
  if (config.mode === 'live') {
    const invite = inputWithLabel('invite', '邀请码');
    invite.input.value = new URLSearchParams(location.search).get('invite') || '';
    invite.input.maxLength = 64;
    invite.input.required = true;
    invite.input.autocomplete = 'off';
    if (location.search) history.replaceState(null, '', location.pathname);
    form.append(invite.box);
  }
  form.append(formCheck('我已年满 18 岁。', 'eligible'));
  form.append(formCheck('我已阅读参与说明，自愿参加。', 'agree'));
  const actions = field('div', '', 'button-row');
  actions.append(button('开始体验', 'primary', 'submit'));
  const error = errorLine();
  form.append(actions, error);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(form);
    submit('/api/start', { eligible: values.has('eligible'), agree: values.has('agree'),
      consentVersion: config.consent.version, invite: values.get('invite') }, error, '正在开始…');
  });
  panel.append(form);
  hero.append(copy, panel);
  return hero;
}

function flow(section) {
  const page = field('div', '', 'flow');
  if (state.stage !== 'done') {
    const progress = field('ol', '', 'progress');
    progress.setAttribute('aria-label', '实验进度');
    const inChat = state.stage === 'chat';
    const current = inChat ? Math.min(state.round - 1, 4) : { surveyIntro: 0, presence: 1, post: 2, background: 3 }[state.stage];
    const labels = inChat ? ['第 1 轮', '第 2 轮', '第 3 轮', '第 4 轮'] : ['问卷说明', '对话感受', '体验反馈', '基本信息'];
    if (inChat && state.round > 4) labels.push('继续对话');
    for (const [i, name] of labels.entries()) {
      const li = field('li', name);
      if (i === current) li.setAttribute('aria-current', 'step');
      progress.append(li);
    }
    page.append(progress);
  }
  page.append(section);
  return page;
}

function messageBubble(sender, label, text) {
  const item = field('li', '', 'message message--' + sender);
  item.append(field('span', label, 'message-sender'), field('p', text, 'message-bubble'));
  return item;
}

function scrollToLatest(thread) {
  thread.scrollTop = thread.scrollHeight;
}

function dialogueThread() {
  const thread = field('ol', '', 'conversation');
  thread.tabIndex = 0;
  thread.setAttribute('aria-label', '对话记录');
  thread.append(messageBubble('assistant', state.label, opener));
  const visibleRounds = state.rounds.slice(0, state.round - 1);
  for (const previous of visibleRounds) {
    if (previous.status === 'skipped') {
      thread.append(field('li', '已跳过第 ' + previous.round + ' 轮', 'message-notice'));
    } else if (previous.status === 'sent') {
      thread.append(messageBubble('participant', '你', previous.user));
      thread.append(messageBubble('assistant', state.label, previous.assistant));
    }
  }
  return thread;
}

function chatPage() {
  const section = field('section', '', 'sheet dialogue-panel');
  const heading = title('第 ' + state.round + ' 轮对话');
  heading.className = 'dialogue-heading';
  const thread = dialogueThread();
  const form = field('form', '', 'dialogue-composer');
  const header = field('div', '', 'dialogue-header');
  const canContinue = state.round > 4;
  const end = button('结束对话', (canContinue ? 'primary' : 'secondary') + ' end-dialogue');
  const duration = field('p', canContinue
    ? '你可以继续聊，也可以随时点击「结束对话」。'
    : '本次对话约有4轮，你可以随时提前结束对话。',
  'dialogue-duration');
  header.append(heading, end, duration);
  section.append(header, thread);
  const label = field('label', '你的文字回复');
  label.htmlFor = 'message';
  const input = field('textarea');
  input.id = 'message';
  input.placeholder = '写下你愿意分享的内容';
  input.maxLength = 420;
  input.setAttribute('enterkeyhint', 'send');
  input.setAttribute('aria-describedby', 'privacy-hint send-hint');
  const help = field('div', '', 'under-input');
  const privacy = field('p', '请避免填写姓名、学号、联系方式或具体地址。', 'hint');
  privacy.id = 'privacy-hint';
  input.value = state.drafts[state.draftKey] ?? state.rounds[state.round - 1]?.user ?? '';
  const counter = field('span', input.value.length + ' / 420', 'hint');
  input.addEventListener('input', () => {
    updateDraft(input.value);
    counter.textContent = input.value.length + ' / 420';
  });
  help.append(privacy, counter);
  const sendHint = field('p', '按 Enter 发送，Shift + Enter 换行。', 'hint send-hint');
  sendHint.id = 'send-hint';
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!busy) form.requestSubmit();
  });
  const actions = field('div', '', 'button-row');
  const skip = button('跳过本轮', 'link-button');
  const error = errorLine();
  actions.append(button('发送回复', 'primary', 'submit'), skip);
  form.append(label, input, help, sendHint, actions, error);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!input.value.trim()) return void setFeedback(error, '请填写内容，或选择跳过本轮。');
    if (busy) return;
    input.readOnly = true;
    const controller = new AbortController();
    const finished = submit('/api/round', { round: state.round, text: input.value }, error, '正在回复…', thread, controller.signal);
    pendingReply = { controller, finished };
    try {
      await finished;
    } finally {
      pendingReply = undefined;
      input.readOnly = false;
    }
  });
  end.addEventListener('click', async () => {
    if (pendingReply) {
      end.disabled = true;
      const { controller, finished } = pendingReply;
      controller.abort();
      await finished;
      end.disabled = false;
    }
    submit('/api/dialogue/end', {}, error, '正在结束对话…');
  });
  skip.addEventListener('click', () => submit('/api/round', { round: state.round, skip: true }, error, '正在继续…'));
  if (config.consent.support) section.append(field('p', config.consent.support, 'contact hint'));
  section.append(form);
  return flow(section);
}

function question([id, label, kind], selected) {
  const box = field('fieldset', '', 'question');
  box.append(field('legend', label));
  const choices = field('div', '', 'choices');
  const options = Array.isArray(kind) ? kind : kind === 'extent'
    ? Array.from({ length: 11 }, (_, index) => String(index)) : agreement;
  options.forEach((option, index) => {
    const label = field('label', '', 'choice');
    const radio = field('input');
    radio.type = 'radio';
    radio.name = id;
    const number = kind === 'extent' ? index : index + 1;
    radio.value = number;
    radio.checked = number === selected;
    const display = kind === 'agreement' ? number + ' ' + option : option;
    label.append(radio, field('span', display));
    choices.append(label);
  });
  const clear = button('清除本题选项', 'link-button clear');
  clear.hidden = selected == null;
  choices.addEventListener('change', () => { clear.hidden = false; });
  clear.addEventListener('click', () => {
    const checked = choices.querySelector(':checked');
    if (checked) { checked.checked = false; checked.focus(); checked.dispatchEvent(new Event('change', { bubbles: true })); }
    clear.hidden = true;
  });
  box.append(choices, clear);
  return box;
}

function surveyIntroPage() {
  const section = field('section', '', 'sheet');
  section.append(title('邀请你填写问卷'));
  section.append(field('p', '谢谢你愿意花时间和我们聊一聊。我们想知道这次对话带给你怎样的体验，也想听听你的真实感受。', 'sheet-lead'));
  section.append(field('p', '如果你愿意，想请你再花几分钟填一份简短问卷。你的回答会帮助我们了解这款产品还有哪些地方需要改进。没有标准答案，按自己的感受填写就好。'));
  section.append(field('p', '填写完全自愿。你可以跳过任何题目，或者现在结束体验。测试版的答案只暂存在当前浏览器会话。', 'hint'));
  const actions = field('div', '', 'button-row');
  const begin = button('开始填写问卷');
  const decline = button('暂不填写', 'link-button');
  const error = errorLine();
  begin.addEventListener('click', () => submit('/api/survey/start', {}, error, '正在打开问卷…'));
  decline.addEventListener('click', () => submit('/api/exit', {}, error, '正在结束体验…'));
  actions.append(begin, decline);
  section.append(actions, error);
  return flow(section);
}

function surveyPage() {
  const screen = screens[state.stage];
  const section = field('section', '', 'sheet');
  section.append(title(screen.title), field('p', screen.description, 'sheet-lead'));
  if (state.stage === 'post') section.append(field('p', '前两题中，0 表示完全不符合，5 表示中等符合，10 表示完全符合。', 'hint'));
  const form = field('form');
  const draft = state.drafts[state.index] ?? {};
  for (const item of screen.questions) form.append(question(item, draft[item[0]]));
  const answers = () => Object.fromEntries([...new FormData(form)].map(([id, value]) => [id, Number(value)]));
  form.addEventListener('change', () => updateDraft(answers()));
  const actions = field('div', '', 'button-row');
  const finish = state.stage === 'background';
  actions.append(button(finish ? '提交并结束' : '提交并继续', 'primary', 'submit'));
  const skip = button(finish ? '跳过并结束' : '跳过这一页', 'link-button');
  actions.append(skip);
  const error = errorLine();
  form.append(actions, error);
  form.addEventListener('submit', event => {
    event.preventDefault();
    submit('/api/survey', { stage: state.stage, answers: answers() }, error, '正在提交…');
  });
  skip.addEventListener('click', () => submit('/api/survey', { stage: state.stage, answers: {} }, error, '正在继续…'));
  section.append(form);
  return flow(section);
}

function endPage() {
  const section = field('section', '', 'sheet');
  const finished = state.status === 'complete';
  section.append(title(finished ? '感谢你的参与' : '本次参与已结束'));
  if (state.status === 'safety_stop') section.append(field('p', '如果你此刻感到难以应对，可以联系身边信任的人或寻求学校心理支持。'));
  if (finished) section.append(field('p', '问卷已提交。我们感谢每个参与者的贡献，请期待最终产品上线！'));
  const code = field('p', '你的研究编号');
  code.append(field('strong', state.id, 'code'));
  section.append(code);
  for (const value of [config.consent.withdrawal, config.consent.contact, config.consent.support]) {
    if (value) section.append(field('p', value, 'contact'));
  }
  const actions = field('div', '', 'button-row');
  const restart = button('重新体验', 'secondary');
  restart.addEventListener('click', () => {
    resetDemo();
    state = null;
    achievement.replaceChildren();
    render(true);
  });
  actions.append(restart);
  section.append(actions);
  return flow(section);
}

function showAchievement() {
  const card = field('div', '', 'achievement-card');
  const badge = field('span', '✦', 'achievement-mark');
  badge.setAttribute('aria-hidden', 'true');
  const copy = field('div');
  copy.append(field('strong', '此时情绪此时天'), field('small', '完成网页的全部探索'));
  const close = button('×', 'achievement-close');
  close.setAttribute('aria-label', '关闭成就提示');
  close.addEventListener('click', () => {
    achievement.replaceChildren();
    app.querySelector('h1').focus({ preventScroll: true });
  });
  card.append(badge, copy, close);
  achievement.replaceChildren(card);
}

function render(focus = false) {
  app.setAttribute('aria-busy', 'false');
  modeLabel.hidden = config.mode !== 'demo';
  exit.hidden = !state || state.stage === 'done';
  previousPage.disabled = !state;
  const pages = { chat: chatPage, surveyIntro: surveyIntroPage, done: endPage };
  app.replaceChildren(state ? (pages[state.stage] ?? surveyPage)() : consentPage());
  const thread = app.querySelector('.conversation');
  if (thread) scrollToLatest(thread);
  if (focus) {
    app.querySelector('h1').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

previousPage.addEventListener('click', () => {
  let error = app.querySelector('.error');
  if (!error) { error = errorLine(); app.append(error); }
  submit('/api/back', {}, error, '正在返回…');
});

exit.addEventListener('click', () => { dialog.returnValue = ''; dialog.showModal(); });
dialog.addEventListener('close', () => {
  if (dialog.returnValue === 'exit') {
    let error = app.querySelector('.error');
    if (!error) { error = errorLine(); app.append(error); }
    submit('/api/exit', {}, error, '正在结束…');
  }
});
try {
  config = await (await request('/api/state')).json();
  state = config.state;
  render();
} catch (err) {
  app.setAttribute('aria-busy', 'false');
  app.replaceChildren(field('p', err.message + ' 请刷新页面重试。', 'error'));
}

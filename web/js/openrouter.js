import { el, api, toast } from './util.js';
import { lang } from './i18n.js';

const l = (ru, en, es = en) => lang === 'ru' ? ru : lang === 'es' ? es : en;
export const cloudLabel = () => l('Облачная студия', 'Cloud studio', 'Estudio en la nube');
export const settingsLabel = () => l('Настройки', 'Settings', 'Ajustes');
const kinds = () => ({ image: l('Фото', 'Images', 'Imágenes'), video: l('Видео', 'Video', 'Vídeo'), speech: l('Озвучка и звуки', 'Speech & sounds', 'Voz y sonidos'), audio: l('Аудиоответ', 'Audio response', 'Respuesta de audio'), transcription: l('Распознавание речи', 'Transcription', 'Transcripción'), text: l('Текст и анализ файлов', 'Text & file analysis', 'Texto y análisis'), embeddings: 'Embeddings', rerank: l('Ранжирование', 'Reranking', 'Reordenamiento'), decisions: l('Классификация (alpha)', 'Decisions (alpha)'), extractions: l('Извлечение данных (alpha)', 'Extractions (alpha)') });
const labels = () => ({ resolution: l('Разрешение', 'Resolution'), aspect_ratio: l('Соотношение сторон', 'Aspect ratio'), duration: l('Длительность, с', 'Duration, s'), generate_audio: l('Звук в видео', 'Generate audio'), seed: 'Seed', size: l('Размер в пикселях', 'Pixel size'), quality: l('Качество', 'Quality'), output_format: l('Формат изображения', 'Image format'), background: l('Фон', 'Background'), output_compression: l('Сжатие', 'Compression'), n: l('Количество изображений', 'Image count'), voice: l('Голос', 'Voice'), speed: l('Скорость речи', 'Speech speed'), instructions: l('Как произнести', 'Delivery instructions'), response_format: l('Формат ответа', 'Response format'), temperature: l('Температура', 'Temperature'), top_p: 'Top P', max_tokens: l('Лимит токенов ответа', 'Maximum output tokens'), reasoning_effort: l('Уровень рассуждений', 'Reasoning effort'), language: l('Язык, например ru', 'Language, e.g. en'), dimensions: l('Размерность вектора', 'Vector dimensions'), top_n: l('Количество результатов', 'Result count'), upscale_factor: l('Коэффициент увеличения', 'Upscale factor'), creativity: l('Креативность', 'Creativity') });
const jsonPost = (url, body) => api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const button = (label, onclick, primary = false) => el('button', { type: 'button', class: `btn ${primary ? 'lime' : ''}`, onclick }, label);
const field = (label, input, help) => el('label', { class: 'or-field' }, el('span', {}, label), input, help ? el('small', { class: 'dim' }, help) : null);
const error = (node, e) => { node.textContent = e.message; node.classList.add('or-error'); };
const safe = async (node, task) => { node.textContent = ''; node.classList.remove('or-error'); try { await task(); } catch (e) { error(node, e); } };

export function settingsView() {
  const state = el('p', { role: 'status', class: 'dim' }, l('Загрузка…', 'Loading…'));
  const result = el('p', { role: 'status', 'aria-live': 'polite' });
  const key = el('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'sk-or-…', 'aria-label': l('Токен OpenRouter', 'OpenRouter API key') });
  const defaults = el('div', { class: 'or-defaults' });
  let disposed = false;
  const draw = (s) => {
    if (disposed) return;
    state.textContent = s.configured ? l(`Токен подключён${s.source === 'environment' ? ' через переменную окружения' : ''}.`, `Key configured${s.source === 'environment' ? ' via environment' : ''}.`) : l('Токен ещё не указан.', 'No key configured yet.');
    defaults.replaceChildren(...Object.entries(s.defaults).map(([kind, d]) => el('a', { href: `#/cloud/${kind}`, class: 'or-default' }, el('b', {}, kinds()[kind] || kind), el('span', { class: 'dim' }, d.model))));
  };
  api('/api/settings').then(draw).catch(e => error(state, e));
  const save = button(l('Сохранить токен', 'Save key', 'Guardar clave'), async () => {
    if (!key.value.trim()) return error(result, new Error(l('Введите токен.', 'Enter a key.')));
    save.disabled = true;
    await safe(result, async () => { draw(await jsonPost('/api/settings', { key: key.value.trim() })); key.value = ''; result.textContent = l('Токен сохранён.', 'Key saved.'); });
    save.disabled = false;
  }, true);
  const node = el('div', { class: 'page or-page' }, el('h1', { class: 'display or-title' }, settingsLabel()),
    el('section', { class: 'or-settings' }, el('h2', {}, 'OpenRouter'), el('p', { class: 'dim' }, l('Один токен для облачных моделей. Генерации оплачиваются с вашего баланса OpenRouter.', 'One key for cloud models. Generations use your OpenRouter balance.')),
      state, field(l('API-токен', 'API key'), key, l('Хранится на сервере Freefield. После сохранения браузер получает только статус подключения. Доступ общий для пользователей этого экземпляра.', 'Stored on the Freefield server. The browser only receives connection status after saving. Shared by users of this instance.')),
      el('div', { class: 'or-actions' }, save, button(l('Проверить подключение', 'Test connection'), () => safe(result, async () => { const r = await jsonPost('/api/openrouter/check', {}); result.textContent = l('Подключение работает.', 'Connection works.') + (r.limit_remaining !== null ? ` $${r.limit_remaining}` : ''); })), button(l('Удалить сохранённый токен', 'Remove saved key'), () => safe(result, async () => { draw(await jsonPost('/api/settings', { key: '' })); result.textContent = l('Сохранённый токен удалён. Ключ из окружения, если задан, продолжает действовать.', 'Saved key removed. An environment key, if configured, still applies.'); }))), result),
    el('section', { class: 'or-settings' }, el('h2', {}, l('Модели по умолчанию', 'Default models')), el('p', { class: 'dim' }, l('Выберите модель и параметры в облачной студии и нажмите «Сохранить по умолчанию».', 'Choose a model and parameters in the cloud studio, then select “Save as default”.')), defaults,
      el('a', { href: '#/cloud', class: 'btn lime' }, cloudLabel())));
  return { node, active: 'settings', dispose() { disposed = true; key.value = ''; } };
}

async function dataURL(file) {
  if (file.size > 25 * 2 ** 20) throw new Error(l('Файл больше 25 МБ.', 'File exceeds 25 MB.'));
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
}
function audioPart(file, url) {
  const ext = file.name.split('.').pop().toLowerCase();
  return { type: 'input_audio', input_audio: { data: url.split(',')[1], format: ext === 'mpeg' ? 'mp3' : ext } };
}

export function cloudView(initialKind = 'image') {
  let disposed = false, models = [], settings = {}, model = null, timer, loadSequence = 0;
  const controls = new Map();
  const kind = el('select', { 'aria-label': l('Тип генерации', 'Generation type') }, ...Object.entries(kinds()).map(([id, label]) => el('option', { value: id }, label)));
  kind.value = kinds()[initialKind] ? initialKind : 'image';
  const search = el('input', { type: 'search', placeholder: l('Найти модель…', 'Find a model…'), 'aria-label': l('Поиск модели', 'Model search') });
  const select = el('select', { 'aria-label': l('Модель OpenRouter', 'OpenRouter model'), required: true });
  const info = el('div', { class: 'or-model-info' });
  const parameters = el('div', { class: 'or-parameters' });
  const prompt = el('textarea', { rows: 6, placeholder: l('Опишите результат, который хотите получить…', 'Describe the result you want…') });
  const promptField = field(l('Запрос / текст', 'Prompt / text'), prompt);
  const uploads = el('input', { type: 'file', multiple: true, accept: 'image/*' });
  const uploadHelp = el('small', { class: 'dim' });
  const uploadField = field(l('Вложения', 'Attachments'), uploads); uploadField.append(uploadHelp);
  const documents = el('textarea', { rows: 5, placeholder: l('Один документ на строку', 'One document per line') });
  const schemaInput = el('textarea', { rows: 6, spellcheck: false });
  const schemaField = field(l('Схема вопросов / полей (JSON)', 'Question / field schema (JSON)'), schemaInput);
  schemaField.hidden = true;
  const documentsField = field(l('Документы для ранжирования', 'Documents to rerank'), documents);
  const first = el('input', { type: 'file', accept: 'image/*' });
  const last = el('input', { type: 'file', accept: 'image/*' });
  const firstField = field(l('Первый кадр', 'First frame'), first), lastField = field(l('Последний кадр', 'Last frame'), last);
  uploadField.hidden = firstField.hidden = lastField.hidden = documentsField.hidden = true;
  const advanced = el('textarea', { rows: 5, placeholder: '{ "provider": { "options": {} } }', spellcheck: false });
  const endpointInfo = el('pre', { class: 'or-json' });
  const message = el('p', { role: 'status', 'aria-live': 'polite' });
  const history = el('div', { class: 'or-history' });
  const connection = el('a', { href: '#/settings', class: 'or-connection' });
  const runButton = el('button', { class: 'btn lime', type: 'submit', disabled: true }, l('Сгенерировать', 'Generate', 'Generar'));
  const nativeDetails = el('details', { class: 'or-advanced' }, el('summary', {}, l('Дополнительные возможности модели', 'Advanced model features')),
    el('p', { class: 'dim' }, l('Нативные параметры OpenRouter: клонирование голоса, несколько спикеров, дополнительные референсы и настройки провайдера. Возможности зависят от модели и провайдера.', 'Native OpenRouter options: voice cloning, multiple speakers, extra references and provider settings. Availability depends on the model and provider.')),
    field(l('Дополнительные параметры (JSON)', 'Extra parameters (JSON)'), advanced),
    el('a', { href: 'https://openrouter.ai/docs/guides/overview/multimodal/overview', target: '_blank', rel: 'noopener', class: 'dim' }, l('Документация OpenRouter', 'OpenRouter documentation')),
    button(l('Показать возможности и цены провайдеров', 'Show provider capabilities and pricing'), async () => {
      if (!model) return;
      const id = model.id;
      await safe(message, async () => { const data = await api(`/api/openrouter/endpoints?model=${encodeURIComponent(model.id)}&kind=${model.kind}`); if (model.id === id) endpointInfo.textContent = JSON.stringify(data, null, 2); });
    }), endpointInfo);

  const readParameters = () => {
    const values = {};
    for (const [key, { input, descriptor: d }] of controls) {
      if (input.value === '') continue;
      values[key] = d.type === 'boolean' ? input.value === 'true' : d.type === 'enum' ? d.values.find(v => String(v) === input.value) : ['integer', 'number', 'range'].includes(d.type) ? Number(input.value) : input.value;
    }
    return values;
  };
  function drawModel() {
    model = models.find(m => m.id === select.value && m.kind === kind.value) || null;
    controls.clear(); parameters.replaceChildren(); endpointInfo.textContent = ''; advanced.value = ''; uploads.value = ''; first.value = ''; last.value = '';
    runButton.disabled = !model || !settings.configured;
    documentsField.hidden = kind.value !== 'rerank';
    if (!model) { info.textContent = l('Нет доступных моделей. Обновите каталог или выберите другой тип.', 'No models available. Refresh catalog or choose another type.'); uploadField.hidden = firstField.hidden = lastField.hidden = true; return; }
    info.replaceChildren(el('b', {}, model.name), el('p', { class: 'dim' }, model.description), el('a', { href: `https://openrouter.ai/${model.id}`, target: '_blank', rel: 'noopener', class: 'dim' }, l('Модель и цены на OpenRouter', 'Model and pricing on OpenRouter')));
    const saved = settings.defaults?.[model.kind];
    for (const [key, d] of Object.entries(model.fields)) {
      const input = d.type === 'enum' || d.type === 'boolean' ? el('select', {}, el('option', { value: '' }, l('Автоматически', 'Automatic')), ...(d.type === 'boolean' ? [true, false] : d.values || []).map(v => el('option', { value: String(v) }, d.type === 'boolean' ? v ? l('Да', 'Yes') : l('Нет', 'No') : String(v)))) : el('input', { type: ['range', 'number', 'integer'].includes(d.type) ? 'number' : 'text', min: d.min, max: d.max, step: d.integer || d.type === 'integer' ? 1 : 'any', placeholder: l('Автоматически', 'Automatic') });
      if (saved?.model === model.id && saved.parameters?.[key] !== undefined) input.value = String(saved.parameters[key]);
      controls.set(key, { input, descriptor: d });
      parameters.append(field(labels()[key] || key, input, d.help === 'provider' ? l('Поддержка зависит от провайдера; пустое поле использует его настройки.', 'Provider-dependent; leave blank for provider defaults.') : null));
    }
    if (model.raw.allowed_passthrough_parameters?.length) info.append(el('p', { class: 'dim' }, l('Параметры провайдера: ', 'Provider options: ') + model.raw.allowed_passthrough_parameters.join(', ')));
    const k = model.kind;
    schemaField.hidden = !['decisions', 'extractions'].includes(k);
    schemaInput.placeholder = k === 'decisions' ? '{ "is_positive": { "type": "noul", "instructions": "Is the text positive?" } }' : '{ "name": { "type": "text", "instructions": "The person name" } }';
    promptField.hidden = k === 'transcription';
    documentsField.hidden = k !== 'rerank';
    uploadField.hidden = !['image', 'video', 'speech', 'text', 'audio', 'transcription'].includes(k) || (k === 'image' && !model.raw.supported_parameters?.input_references) || (['text', 'audio'].includes(k) && !model.inputs.some(i => ['image', 'audio', 'video', 'file'].includes(i)));
    uploads.multiple = k !== 'transcription';
    uploads.accept = k === 'transcription' ? 'audio/*' : k === 'speech' ? 'audio/*,image/*' : k === 'image' ? 'image/*' : model.inputs.filter(i => ['image', 'audio', 'video', 'file'].includes(i)).map(i => i === 'file' ? '.pdf' : `${i}/*`).join(',');
    uploadHelp.textContent = k === 'speech' ? l('Образец голоса и изображение сцены. Клонирование голоса и работа с изображениями поддерживаются отдельными провайдерами — проверьте их возможности ниже.', 'Voice sample and scene image. Voice cloning and image conditioning depend on provider capabilities; inspect them below.') : k === 'video' ? l('Референсы и исходное видео для редактирования/увеличения. Доступные типы определяются выбранной моделью.', 'References and source video for editing/upscaling. Accepted types depend on the selected model.') : l('До 25 МБ на файл, около 30 МБ суммарно. Вложения отправляются выбранному провайдеру.', 'Up to 25 MB per file, about 30 MB total. Attachments are sent to the selected provider.');
    firstField.hidden = k !== 'video' || !model.raw.supported_frame_images?.includes('first_frame');
    lastField.hidden = k !== 'video' || !model.raw.supported_frame_images?.includes('last_frame');
  }
  function filterModels(preferred) {
    const list = models.filter(m => m.kind === kind.value && `${m.name} ${m.id}`.toLowerCase().includes(search.value.toLowerCase()));
    select.replaceChildren(...list.map(m => el('option', { value: m.id }, m.name)));
    const target = preferred || settings.defaults?.[kind.value]?.model;
    if (list.some(m => m.id === target)) select.value = target;
    drawModel();
  }
  async function load(refresh = false) {
    const sequence = ++loadSequence;
    runButton.disabled = true;
    await safe(message, async () => {
      const [s, c] = await Promise.all([api('/api/settings'), api(`/api/openrouter/models${refresh ? '?refresh=1' : ''}`)]);
      if (disposed || sequence !== loadSequence) return;
      settings = s; models = c.models;
      connection.textContent = s.configured ? l('OpenRouter подключён · Настройки', 'OpenRouter connected · Settings') : l('Укажите токен в настройках', 'Add a key in Settings');
      filterModels();
      if (c.warnings.length) message.textContent = c.warnings.join('\n');
    });
  }
  kind.onchange = () => { search.value = ''; location.hash = `#/cloud/${kind.value}`; };
  search.oninput = () => filterModels(select.value);
  select.onchange = drawModel;
  const form = el('form', { class: 'or-form' }, field(l('Тип генерации', 'Generation type'), kind), field(l('Поиск', 'Search'), search), field(l('Модель', 'Model'), select), info,
    promptField, uploadField, firstField, lastField, documentsField, schemaField, parameters, nativeDetails,
    el('p', { class: 'dim' }, l('Нажатие «Сгенерировать» отправит запрос в OpenRouter и может списать средства. Цены зависят от модели и провайдера.', 'Generate sends a request to OpenRouter and may spend credits. Prices depend on the model and provider.')),
    el('div', { class: 'or-actions' }, runButton, button(l('Сохранить по умолчанию', 'Save as default'), () => safe(message, async () => {
      if (!model) return;
      settings = await jsonPost('/api/openrouter/defaults', { model: model.id, kind: model.kind, parameters: readParameters() });
      message.textContent = l('Модель и параметры сохранены.', 'Default model and parameters saved.');
    }))), message);
  form.onsubmit = async (event) => {
    event.preventDefault(); if (!model || runButton.disabled) return;
    runButton.disabled = true;
    await safe(message, async () => {
      let extra = advanced.value.trim() ? JSON.parse(advanced.value) : {};
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error(l('Ожидается JSON-объект.', 'Expected a JSON object.'));
      const attached = [];
      const files = uploadField.hidden ? [] : [...uploads.files];
      const allFiles = [...files, ...(!firstField.hidden ? [...first.files] : []), ...(!lastField.hidden ? [...last.files] : [])];
      if (allFiles.reduce((n, f) => n + f.size, 0) > 29 * 2 ** 20) throw new Error(l('Суммарный размер файлов больше 29 МБ.', 'Total attachments exceed 29 MB.'));
      for (const f of files) {
        const url = await dataURL(f);
        if (f.type.startsWith('image/')) attached.push({ type: 'image_url', image_url: { url } });
        else if (f.type.startsWith('audio/')) attached.push(model.kind === 'video' ? { type: 'audio_url', audio_url: { url } } : audioPart(f, url));
        else if (f.type.startsWith('video/')) attached.push({ type: 'video_url', video_url: { url } });
        else if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) attached.push({ type: 'file', file: { filename: f.name, file_data: url } });
        else throw new Error(l('Неподдерживаемый тип файла.', 'Unsupported file type.'));
      }
      if (model.kind === 'transcription') {
        if (attached.length !== 1 || attached[0].type !== 'input_audio') throw new Error(l('Выберите аудиофайл.', 'Choose an audio file.'));
        extra.input_audio = attached[0].input_audio;
      } else if (['image', 'video', 'speech'].includes(model.kind) && attached.length) extra.input_references = attached;
      else if (attached.length) extra.messages = [{ role: 'user', content: [{ type: 'text', text: prompt.value }, ...attached] }];
      if (model.kind === 'video') {
        const frames = [];
        if (!firstField.hidden && first.files[0]) frames.push({ frame_type: 'first_frame', image_url: { url: await dataURL(first.files[0]) }, type: 'image_url' });
        if (!lastField.hidden && last.files[0]) frames.push({ frame_type: 'last_frame', image_url: { url: await dataURL(last.files[0]) }, type: 'image_url' });
        if (frames.length) extra.frame_images = frames;
      }
      if (['decisions', 'extractions'].includes(model.kind)) extra[model.kind === 'decisions' ? 'questions' : 'fields'] = JSON.parse(schemaInput.value);
      if (model.kind === 'rerank') extra.documents = documents.value.split('\n').filter(s => s.trim());
      const r = await jsonPost('/api/openrouter/runs', { model: model.id, kind: model.kind, prompt: prompt.value, parameters: readParameters(), advanced: extra });
      message.textContent = l('Задание принято. Результат появится в истории справа.', 'Job accepted. Results will appear in the history.');
      await refreshHistory();
    });
    runButton.disabled = !model || !settings.configured;
  };
  function runCard(run) {
    const status = { starting: l('Отправляется', 'Submitting'), queued: l('В очереди', 'Queued'), running: l('Генерация', 'Generating'), succeeded: l('Готово', 'Complete'), failed: l('Ошибка', 'Failed'), interrupted: l('Прервано', 'Interrupted') }[run.status] || run.status;
    const node = el('article', { class: 'or-run' }, el('div', { class: 'or-run-head' }, el('b', {}, run.model), el('span', { class: run.status === 'failed' ? 'or-error' : 'dim' }, status)), el('small', { class: 'dim' }, new Date(run.created).toLocaleString()), el('p', {}, run.prompt));
    if (run.job) node.append(el('small', { class: 'dim' }, `OpenRouter job: ${run.job}`));
    if (run.error) node.append(el('p', { class: 'or-error' }, run.error));
    for (const out of run.outputs) {
      const url = `/api/openrouter/runs/${run.id}/${encodeURIComponent(out.file)}`;
      const media = out.type.startsWith('image/') && out.type !== 'image/svg+xml' ? el('img', { src: url, alt: run.prompt, loading: 'lazy' }) : out.type.startsWith('video/') ? el('video', { src: url, controls: true, preload: 'metadata', playsinline: true }) : out.type.startsWith('audio/') && !out.file.endsWith('.pcm') ? el('audio', { src: url, controls: true, preload: 'metadata' }) : null;
      node.append(el('div', { class: 'or-output' }, media, el('a', { href: url, download: out.file, class: 'btn small' }, l('Скачать', 'Download'))));
    }
    if (run.text) node.append(el('pre', { class: 'or-text' }, run.text), button(l('Скопировать текст', 'Copy text'), () => navigator.clipboard.writeText(run.text).catch(e => toast(e.message, { error: true }))));
    if (run.usage) node.append(el('details', {}, el('summary', {}, l('Расход и стоимость', 'Usage and cost')), el('pre', { class: 'or-json' }, JSON.stringify(run.usage, null, 2))));
    return node;
  }
  async function refreshHistory() {
    clearTimeout(timer);
    try {
      const { runs } = await api('/api/openrouter/runs');
      if (disposed) return;
      history.replaceChildren(...(runs.length ? runs.map(runCard) : [el('div', { class: 'or-empty' }, el('h3', {}, l('Здесь будут ваши результаты', 'Your results appear here')), el('p', { class: 'dim' }, l('Выберите модель, напишите запрос и запустите генерацию. История сохраняется на сервере Freefield.', 'Choose a model, enter a prompt and generate. History is saved on the Freefield server.')))]));
      timer = setTimeout(refreshHistory, runs.some(r => ['starting', 'queued', 'running'].includes(r.status)) ? 3000 : 15000);
    } catch (e) { if (!disposed) { history.replaceChildren(el('p', { class: 'or-error' }, e.message)); timer = setTimeout(refreshHistory, 15000); } }
  }
  const node = el('div', { class: 'page or-page' }, el('div', { class: 'or-heading' }, el('div', {}, el('h1', { class: 'display or-title' }, cloudLabel()), connection), button(l('Обновить модели', 'Refresh models'), () => load(true))),
    el('div', { class: 'or-layout' }, form, el('section', { class: 'or-results' }, el('h2', {}, l('Облачная история', 'Cloud history')), history)));
  load(); refreshHistory();
  return { node, active: 'cloud', dispose() { disposed = true; clearTimeout(timer); } };
}

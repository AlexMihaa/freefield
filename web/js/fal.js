import { el, api } from './util.js';
import { lang } from './i18n.js';
const l = (ru,en,es=en) => lang==='ru'?ru:lang==='es'?es:en;
const field = (name,input,help) => el('label',{class:'or-field'},el('span',{},name),input,help?el('small',{class:'dim'},help):null);
const post = (path,body) => api(`/api/fal/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const button = (name,fn) => el('button',{class:'btn',type:'button',onclick:fn},name);
const report = (node,e) => {node.classList.add('or-error');node.textContent=e.message;};

export function falSettingsPanel() {
  let disposed=false;
  const state=el('p',{class:'dim',role:'status'},l('Загрузка…','Loading…'));
  const result=el('p',{'aria-live':'polite'});
  const key=el('input',{type:'password',autocomplete:'off',spellcheck:false,'aria-label':l('Токен fal.ai','fal.ai API key'),placeholder:'FAL_KEY'});
  const draw=s=>{if(!disposed)state.textContent=s.configured?l('Ключ fal.ai сохранён. Его доступ к генерациям проверяется при запуске.', 'fal.ai key configured. Generation access is checked when submitting a run.'):l('Ключ fal.ai ещё не указан.','No fal.ai key configured.');};
  api('/api/fal/settings').then(draw).catch(e=>report(state,e));
  const save=button(l('Сохранить ключ fal.ai','Save fal.ai key'),async()=>{
    result.textContent='';result.classList.remove('or-error');save.disabled=true;
    try {if(!key.value.trim())throw new Error(l('Введите ключ fal.ai.','Enter a fal.ai key.'));draw(await post('settings',{key:key.value.trim()}));key.value='';result.textContent=l('Ключ fal.ai сохранён.','fal.ai key saved.');}catch(e){report(result,e);}finally{save.disabled=false;}
  }); save.classList.add('lime');
  const node=el('section',{class:'or-settings'},el('h2',{},'fal.ai'),
    el('p',{class:'dim'},l('Отдельный провайдер и баланс. Kling Motion Control переносит движения из видео на персонажа с фотографии.','Separate provider and balance. Kling Motion Control transfers video motion to a character image.')),
    state,field(l('API-ключ fal.ai','fal.ai API key'),key,l('Хранится на сервере Freefield, не возвращается в браузер после сохранения. Токен OpenRouter здесь не подходит.','Stored on the Freefield server and never returned to the browser. An OpenRouter key cannot be used here.')),
    el('div',{class:'or-actions'},save,button(l('Удалить сохранённый ключ','Remove saved key'),async()=>{try{draw(await post('settings',{key:''}));result.textContent=l('Ключ из настроек удалён. Если задан FAL_KEY в окружении, он продолжает действовать.','Saved key removed. An environment FAL_KEY, if set, still applies.');}catch(e){report(result,e);}})),result,
    el('div',{class:'or-actions'},el('a',{href:'https://fal.ai/dashboard/keys',target:'_blank',rel:'noopener',class:'btn small'},l('Получить ключ fal.ai','Get a fal.ai key')),el('a',{href:'#/fal',class:'btn small'},l('Открыть Motion Control','Open Motion Control'))));
  return {node,dispose(){disposed=true;key.value='';}};
}

async function inputMedia(file,url,kind) {
  if(file && url.trim())throw new Error(l('Выберите файл или ссылку для каждого входа, не оба варианта.','Choose either a file or a URL for each input.'));
  if(file) {
    if(file.size>25*2**20 || !file.size)throw new Error(l('Допустим файл от 1 байта до 25 МБ.','File must be between 1 byte and 25 MB.'));
    const ext=file.name.split('.').pop().toLowerCase();
    const mime=file.type || ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif',gif:'image/gif',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',m4v:'video/x-m4v'}[ext]);
    if(!mime || !(kind==='image'?mime.startsWith('image/'):mime.startsWith('video/')||mime==='image/gif'))throw new Error(l('Неподдерживаемый тип файла.','Unsupported file type.'));
    const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(new Error(l('Не удалось прочитать файл.','Unable to read file.')));r.readAsDataURL(file);});
    return `data:${mime};base64,${data}`;
  }
  try {const u=new URL(url.trim());if(u.protocol!=='https:'||u.username||u.password)throw new Error();return u.href;}
  catch {throw new Error(l('Выберите файл или укажите прямую HTTPS-ссылку.','Choose a file or enter a direct HTTPS URL.'));}
}

export function falView() {
  let disposed=false,timer,settings={},models=[];
  const select=el('select',{'aria-label':l('Модель fal.ai','fal.ai model')});
  const info=el('p',{class:'dim'});
  const orientation=el('select',{},el('option',{value:'video'},l('По видео — для танца и движений тела','Match video — dance and body motion')),el('option',{value:'image'},l('По фото — сохранить ориентацию персонажа','Match image — preserve character orientation')));
  const sound=el('input',{type:'checkbox',checked:true});
  const photo=el('input',{type:'file',accept:'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif'});
  const clip=el('input',{type:'file',accept:'video/mp4,video/quicktime,video/webm,video/x-m4v,image/gif'});
  const photoURL=el('input',{type:'url',placeholder:'https://…/photo.jpg'});
  const clipURL=el('input',{type:'url',placeholder:'https://…/video.mp4'});
  const prompt=el('textarea',{rows:3,maxlength:2500,placeholder:l('Сохранить внешность и одежду персонажа с фото.','Preserve the appearance and clothing from the character image.')});
  const message=el('p',{role:'status','aria-live':'polite'});
  const connection=el('a',{href:'#/settings',class:'or-connection'},l('Настройки fal.ai','fal.ai settings'));
  const results=el('div',{class:'or-history'});
  const submit=el('button',{class:'btn lime',type:'submit',disabled:true},l('Сгенерировать через fal.ai','Generate with fal.ai'));
  const panel=el('form',{class:'or-form'},field(l('Модель','Model'),select),info,
    field(l('Фото персонажа','Character image'),photo,l('Выберите фото с компьютера, желательно в полный рост. До 25 МБ.','Choose a local image, preferably full-body. Up to 25 MB.')),
    field(l('Видео с движениями','Motion reference video'),clip,l('Локальный ролик до 25 МБ. Персонаж должен быть хорошо виден.','Local clip up to 25 MB. The performer should stay clearly visible.')),
    el('details',{class:'or-advanced'},el('summary',{},l('Вместо файлов использовать HTTPS-ссылки','Use HTTPS URLs instead of local files')),field(l('Ссылка на фото','Image URL'),photoURL),field(l('Ссылка на видео','Video URL'),clipURL)),
    field(l('Ориентация персонажа','Character orientation'),orientation),
    el('label',{class:'fal-check'},sound,l('Сохранить звук исходного видео','Keep original video sound')),
    field(l('Указания (необязательно)','Instructions (optional)'),prompt),
    el('p',{class:'dim'},l('Режим «По видео»: до 30 секунд. «По фото»: до 10 секунд. Начните с короткого фрагмента. Качество переноса движений животного на человека зависит от исходников.','Match video: up to 30 seconds. Match image: up to 10 seconds. Start with a short clip. Animal-to-human motion quality depends on the inputs.')),
    el('p',{class:'dim'},l('Нажатие отправит фото и видео в fal.ai и может списать средства с его баланса. Материалы проверяет провайдер; успешное прохождение модерации не гарантировано.','Generate sends the image and video to fal.ai and may spend your fal balance. Provider moderation applies.')),
    el('div',{class:'or-actions'},submit,button(l('Сохранить по умолчанию','Save as default'),async()=>{
      try{settings=await post('settings',{defaults:{model:select.value,orientation:orientation.value,keep_original_sound:sound.checked}});message.textContent=l('Настройки сохранены.','Defaults saved.');message.classList.remove('or-error');}catch(e){report(message,e);}
    })),message);
  function drawModel(){const m=models.find(m=>m.id===select.value);info.replaceChildren(m?el('a',{href:m.url,target:'_blank',rel:'noopener'},l('Возможности и актуальная цена на fal.ai','Capabilities and current price on fal.ai')):l('Модели загружаются…','Loading models…'));}
  select.onchange=drawModel;
  panel.onsubmit=async e=>{
    e.preventDefault();if(submit.disabled)return;submit.disabled=true;message.textContent='';message.classList.remove('or-error');
    try {
      if((photo.files[0]?.size||0)+(clip.files[0]?.size||0)>29*2**20)throw new Error(l('Суммарный размер файлов больше 29 МБ.','Total files exceed 29 MB.'));
      const image_url=await inputMedia(photo.files[0],photoURL.value,'image');
      const video_url=await inputMedia(clip.files[0],clipURL.value,'video');
      await post('runs',{model:select.value,image_url,video_url,prompt:prompt.value,character_orientation:orientation.value,keep_original_sound:sound.checked});
      message.textContent=l('Задание отправлено. Результат появится в истории справа.','Request submitted. Results will appear in the history.');await history();
    }catch(e){report(message,e);}finally{submit.disabled=!settings.configured;}
  };
  function card(run) {
    const status={starting:l('Отправляется','Submitting'),queued:l('В очереди','Queued'),running:l('Генерация','Generating'),waiting_key:l('Ожидает ключ fal.ai','Waiting for fal.ai key'),succeeded:l('Готово','Complete'),failed:l('Ошибка','Failed'),interrupted:l('Прервано','Interrupted')}[run.status]||run.status;
    const m=models.find(m=>m.id===run.model);
    const node=el('article',{class:'or-run'},el('div',{class:'or-run-head'},el('b',{},m?.name||run.model),el('span',{class:run.status==='failed'?'or-error':'dim'},status)),el('small',{class:'dim'},new Date(run.created).toLocaleString()),run.prompt?el('p',{},run.prompt):null);
    if(run.queue!==undefined && run.status==='queued')node.append(el('p',{class:'dim'},l('Место в очереди: ','Queue position: ')+run.queue));
    if(run.request_id)node.append(el('small',{class:'dim'},`fal request: ${run.request_id}`));
    if(run.error)node.append(el('p',{class:'or-error'},run.error));
    for(const out of run.outputs){const url=`/api/fal/runs/${run.id}/${out.file}`;node.append(el('div',{class:'or-output'},el('video',{src:url,controls:true,preload:'metadata',playsinline:true}),el('a',{href:url,download:out.file,class:'btn small'},l('Скачать','Download'))));}
    return node;
  }
  async function history(){
    clearTimeout(timer);
    try{const {runs}=await api('/api/fal/runs');if(disposed)return;results.replaceChildren(...(runs.length?runs.map(card):[el('div',{class:'or-empty'},el('h3',{},l('Результаты Motion Control','Motion Control results')),el('p',{class:'dim'},l('Фото задаёт внешность, видео — движения. Задания и результаты сохраняются на сервере.','The image defines appearance; the video defines motion. Requests and results are saved on the server.')))]));timer=setTimeout(history,runs.some(r=>['starting','queued','running'].includes(r.status))?3000:15000);}catch(e){if(!disposed){results.replaceChildren(el('p',{class:'or-error'},e.message));timer=setTimeout(history,15000);}}
  }
  async function load(){
    try{const [s,c]=await Promise.all([api('/api/fal/settings'),api('/api/fal/models')]);if(disposed)return;settings=s;models=c.models;select.replaceChildren(...models.map(m=>el('option',{value:m.id},m.name)));if(s.defaults){select.value=s.defaults.model;orientation.value=s.defaults.orientation;sound.checked=s.defaults.keep_original_sound;}drawModel();submit.disabled=!s.configured;connection.textContent=s.configured?l('Ключ fal.ai сохранён · Настройки','fal.ai key configured · Settings'):l('Добавьте ключ fal.ai в настройках','Add a fal.ai key in Settings');await history();}catch(e){if(!disposed)report(message,e);}
  }
  const node=el('div',{class:'page or-page'},el('div',{class:'or-heading'},el('div',{},el('h1',{class:'display or-title'},'fal.ai · Motion Control'),connection)),
    el('div',{class:'or-provider-tabs'},el('a',{href:'#/cloud',class:'btn small'},'OpenRouter'),el('a',{href:'#/fal',class:'btn lime small','aria-current':'page'},'fal.ai')),
    el('div',{class:'or-layout'},panel,el('section',{class:'or-results'},el('h2',{},l('История fal.ai','fal.ai history')),results)));
  load();return {node,active:'fal',dispose(){disposed=true;clearTimeout(timer);}};
}

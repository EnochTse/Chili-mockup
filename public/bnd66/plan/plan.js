const examples = {
  current: ['現有輸出 · 透明 PNG', '正面和側面合在一張圖', '現行工具的下載會移除標記並保留透明背景。這張圖方便排版，寄給客人時要另外說明印面、工藝和尺寸。'],
  client: ['建議輸出 · 客戶提案', '全筆配色與 Logo 近鏡', '以中性背景展示整支筆，同頁給 Logo 一個清晰的近鏡。銷售可以把單張圖片放入簡報或轉發給客戶。'],
  proof: ['建議輸出 · 校稿版面', '讓收件人核對印面和尺寸', '全筆定位圖配局部尺寸和閱讀方向。示意圖呈現 A4 校稿單的資訊層次，正式 PDF 會按毫米繪製印區和校驗線。']
};
const controls = [...document.querySelectorAll('[data-pick]')];
for (const control of controls) {
  control.addEventListener('click', () => {
    const active = control.dataset.pick;
    const [kind, title, description] = examples[active];
    for (const candidate of controls) {
      const selected = candidate.dataset.pick === active;
      candidate.setAttribute('aria-pressed', String(selected));
      document.getElementById('exhibit-' + candidate.dataset.pick).hidden = !selected;
    }
    document.getElementById('exhibit-kind').textContent = kind;
    document.getElementById('exhibit-title').textContent = title;
    document.getElementById('exhibit-desc').textContent = description;
  });
}
import('./proof-demo.js').catch(() => {
  const status = document.getElementById('art-status');
  status.hidden = false;
  status.textContent = '未能載入產品圖。你仍可切換三種樣式，閱讀設計和輸出規格。';
});

const dialog = document.getElementById('viewer');
const largeImage = document.getElementById('viewer-image');
const actual = document.getElementById('actual');
document.getElementById('enlarge').addEventListener('click', () => {
  const key = controls.find(control => control.getAttribute('aria-pressed') === 'true').dataset.pick;
  const source = document.getElementById('exhibit-' + key);
  if (!document.getElementById('art-status').hidden) {
    document.getElementById('art-status').scrollIntoView({block:'nearest'});
    return;
  }
  largeImage.src = source.toDataURL('image/png');
  largeImage.alt = source.getAttribute('aria-label');
  largeImage.classList.remove('actual');
  actual.setAttribute('aria-pressed', 'false');
  document.getElementById('viewer-title').textContent = examples[key][0];
  dialog.showModal();
});
actual.addEventListener('click', () => {
  const enabled = largeImage.classList.toggle('actual');
  actual.setAttribute('aria-pressed', String(enabled));
  const scroller = largeImage.parentElement;
  scroller.scrollTo({left: enabled ? (largeImage.width - scroller.clientWidth) / 2 : 0, top: 0});
});
document.getElementById('dismiss').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => largeImage.removeAttribute('src'));

/** Local-only reading preference; no network calls or changes to lesson behavior. */
function enhanceCoursePresentation() {
  const header = document.querySelector<HTMLElement>('.site-header, .topbar, .top');
  const hero = document.querySelector<HTMLElement>('.hero');
  if (!header || !hero) return;
  const root = document.documentElement;
  const preferences = document.createElement('div');
  preferences.className = 'course-reading';
  preferences.setAttribute('role', 'group');
  preferences.setAttribute('aria-label', 'Text size');
  const label = document.createElement('span');
  label.textContent = 'Text size';
  preferences.append(label);
  let size = 'comfortable';
  try {
    if (localStorage.getItem('agent-course-text-size') === 'large') size = 'large';
  } catch {}
  const apply = (value: string) => {
    root.dataset.textSize = value;
    for (const button of preferences.querySelectorAll('button'))
      button.setAttribute('aria-pressed', String(button.dataset.size === value));
  };
  for (const [value, title] of [
    ['comfortable', 'Comfortable'],
    ['large', 'Larger'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.size = value;
    button.textContent = title!;
    button.addEventListener('click', () => {
      apply(value!);
      try {
        localStorage.setItem('agent-course-text-size', value!);
      } catch {}
    });
    preferences.append(button);
  }
  header.append(preferences);
  apply(size);
  const lesson = header.textContent?.match(/(?:LESSON|LABS\s*\/)\s*(\d{2})/i)?.[1] || '';
  const figure = document.createElement('figure');
  figure.className = 'course-mascot';
  const image = document.createElement('img');
  image.src = '/course-astronaut.png';
  image.alt = 'Claude Agent SDK course astronaut mascot';
  image.width = 220;
  image.height = 287;
  const caption = document.createElement('figcaption');
  caption.textContent = `${lesson ? 'Lesson ' + lesson + ' · ' : ''}Claude Agent SDK`;
  figure.append(image, caption);
  const focus = hero.querySelector<HTMLElement>('.lesson-note, .lesson-card');
  if (focus) {
    const details = document.createElement('details');
    details.className = 'course-focus';
    const summary = document.createElement('summary');
    summary.textContent = 'Lesson focus & author';
    details.append(summary, focus);
    hero.after(details);
  }
  hero.querySelector('.hero-art')?.remove();
  hero.append(figure);
}
queueMicrotask(enhanceCoursePresentation);

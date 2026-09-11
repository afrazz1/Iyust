// Annotation coordinates and camera views use the normalized model's space.
export function annotationEditor({THREE, canvas, camera, controls, getRoot, fly, fit, createPoints, notify}) {
  const $ = id => document.getElementById(id);
  const edit = $('edit-mode'), start = $('tour-start'), panel = $('point-panel');
  const dialog = $('point-editor'), form = $('point-form');
  let model = null, points = [], selected = -1, editing = false, touring = false, ready = false;
  let draft = null, down = null;
  const pointers = new Set();
  const raycaster = new THREE.Raycaster();
  const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  const valid = p => p && typeof p.title === 'string' && typeof p.description === 'string' && vector(p.position) && (!p.view || (vector(p.view.position) && vector(p.view.target)));
  const key = () => `object-notes:annotations:v1:${model.id}`;

  function refresh() {
    createPoints(points.map(p => [p.position, p.title]));
    edit.disabled = !ready;
    start.disabled = !ready || !points.length;
    edit.setAttribute('aria-pressed', String(editing));
    edit.textContent = editing ? 'Завершить редактирование' : 'Редактор точек';
    canvas.classList.toggle('placing', editing);
    $('viewer-hint').textContent = editing
      ? 'Кликните по поверхности модели, чтобы добавить точку. Нажмите на существующую точку, чтобы изменить её.'
      : 'Выберите точку, чтобы приблизиться. Мышь — вращение, колесо — масштаб.';
    showPanel();
  }

  function showPanel() {
    const p = points[selected];
    panel.hidden = !p || editing;
    if (!p) return;
    $('point-count').textContent = touring ? `Экскурсия · ${selected + 1} из ${points.length}` : `Точка ${selected + 1} из ${points.length}`;
    $('point-title').textContent = p.title;
    $('point-description').textContent = p.description || 'Описание пока не добавлено.';
    $('point-actions').hidden = touring;
    $('tour-actions').hidden = !touring;
    $('tour-prev').disabled = selected === 0;
    $('tour-next').textContent = selected === points.length - 1 ? 'Завершить' : 'Дальше →';
  }

  function save(next) {
    try { localStorage.setItem(key(), JSON.stringify(next)); }
    catch { notify('Не удалось сохранить точки в браузере. Проверьте доступ к хранилищу.'); return false; }
    points = next;
    refresh();
    return true;
  }

  function visit(index) {
    if (!ready || !points[index]) return;
    selected = index;
    const p = points[index], root = getRoot();
    const target = root.localToWorld(new THREE.Vector3(...(p.view?.target || p.position)));
    const position = p.view
      ? root.localToWorld(new THREE.Vector3(...p.view.position))
      : target.clone().addScaledVector(new THREE.Vector3(.72,.34,1).normalize(), 1.8);
    fly(position, target, 850);
    document.querySelectorAll('.annotation').forEach((el, i) => el.classList.toggle('active', i === index));
    showPanel();
  }

  function openEditor(index, position) {
    selected = index;
    draft = index >= 0 ? points[index] : {
      title: '', description: '', position,
      view: { position: getRoot().worldToLocal(camera.position.clone()).toArray(), target: position }
    };
    $('editor-title').textContent = index >= 0 ? 'Редактировать точку' : 'Новая точка';
    $('annotation-title').value = draft.title;
    $('annotation-description').value = draft.description;
    $('point-delete').hidden = index < 0;
    showPanel();
    dialog.showModal();
    $('annotation-title').focus();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const title = $('annotation-title').value.trim();
    if (!title) { $('annotation-title').setCustomValidity('Введите название точки.'); $('annotation-title').reportValidity(); return; }
    const next = points.slice(), p = {...draft, title, description: $('annotation-description').value.trim()};
    const index = selected < 0 ? next.length : selected;
    next[index] = p;
    if (save(next)) { selected = index; dialog.close(); showPanel(); }
  });
  $('annotation-title').oninput = () => $('annotation-title').setCustomValidity('');
  $('editor-cancel').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { draft = null; $('annotation-title').setCustomValidity(''); });
  $('point-delete').onclick = () => {
    const index = selected;
    selected = -1;
    if (save(points.filter((_, i) => i !== index))) dialog.close();
    else selected = index;
  };
  edit.onclick = () => {
    touring = false; controls.enabled = true; editing = !editing; selected = -1; refresh();
  };
  start.onclick = () => {
    editing = false; touring = true; controls.enabled = false; refresh(); visit(0); $('tour-next').focus();
  };
  function exitTour() {
    touring = false; selected = -1; controls.enabled = true; refresh();
    if (ready) fit(getRoot(), true);
  }
  $('tour-prev').onclick = () => visit(selected - 1);
  $('tour-next').onclick = () => selected === points.length - 1 ? exitTour() : visit(selected + 1);
  $('tour-exit').onclick = exitTour;
  $('point-close').onclick = () => { selected = -1; showPanel(); };
  $('point-edit').onclick = () => openEditor(selected);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && touring && !document.querySelector('dialog[open]')) exitTour(); });

  canvas.addEventListener('pointerdown', event => {
    pointers.add(event.pointerId);
    down = pointers.size === 1 && event.isPrimary && event.button === 0
      ? {id: event.pointerId, x: event.clientX, y: event.clientY} : null;
  });
  canvas.addEventListener('pointermove', event => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) down = null;
  });
  canvas.addEventListener('pointercancel', event => { pointers.delete(event.pointerId); down = null; });
  canvas.addEventListener('pointerup', event => {
    pointers.delete(event.pointerId);
    const click = down && down.id === event.pointerId;
    down = null;
    if (!click || !editing || !ready || dialog.open) return;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1, -(event.clientY-rect.top)/rect.height*2+1), camera);
    const hit = raycaster.intersectObject(getRoot(), true).find(hit => hit.object.isMesh);
    if (hit) openEditor(-1, getRoot().worldToLocal(hit.point.clone()).toArray());
  });

  return {
    select(index) { if (touring) return; editing ? openEditor(index) : visit(index); },
    reset: exitTour,
    unload() { ready = false; touring = false; editing = false; selected = -1; points = []; controls.enabled = true; dialog.close(); refresh(); },
    load(config) {
      model = config; ready = true;
      points = config.points.map(([position, title]) => ({position, title, description: ''}));
      try {
        const stored = localStorage.getItem(key());
        if (stored !== null) {
          const parsed = JSON.parse(stored);
          if (!Array.isArray(parsed) || !parsed.every(valid)) throw new Error('Invalid annotation data');
          points = parsed;
        }
      } catch { notify('Сохранённые точки недоступны. Показаны исходные аннотации.'); }
      refresh();
    }
  };
}

// Annotation coordinates and camera views use the normalized model's space.
// Shared team code: change this phrase to change access to the editor.
const EDITOR_ACCESS_CODE = 'экспозиция-команда';

export function annotationEditor({THREE, canvas, camera, controls, getRoot, fly, fit, createPoints, notify}) {
  const $ = id => document.getElementById(id);
  const edit = $('edit-mode'), start = $('tour-start'), panel = $('point-panel');
  const dialog = $('point-editor'), form = $('point-form');
  const accessDialog = $('editor-access'), accessForm = $('access-form'), accessCode = $('access-code');
  let model = null, points = [], selected = -1, editing = false, touring = false, ready = false;
  let draft = null, down = null, dragged = null, generation = 0;
  const list = $('tour-order'), upload = $('points-file');
  const pointers = new Set();
  const raycaster = new THREE.Raycaster();
  const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  const valid = p => p && typeof p.title === 'string' && typeof p.description === 'string' && vector(p.position) && (p.view == null || (vector(p.view.position) && vector(p.view.target)));
  const key = () => `object-notes:annotations:v1:${model.id}`;

  function refresh() {
    createPoints(points.map(p => [p.position, p.title]));
    edit.disabled = !ready;
    start.disabled = !ready || !points.length;
    $('points-download').disabled = !ready;
    $('points-upload').disabled = !ready;
    $('points-download').hidden = !editing;
    $('points-upload').hidden = !editing;
    $('point-edit').hidden = !editing;
    $('order-panel').hidden = !ready || !editing;
    renderOrder();
    edit.setAttribute('aria-pressed', String(editing));
    edit.textContent = editing ? 'Завершить редактирование' : 'Редактор точек';
    canvas.classList.toggle('placing', editing);
    $('viewer-hint').textContent = editing
      ? 'Кликните по поверхности модели, чтобы добавить точку. Нажмите на существующую точку, чтобы изменить её.'
      : 'Выберите точку, чтобы приблизиться. Мышь — вращение, колесо — масштаб.';
    showPanel();
  }

  function renderOrder() {
    list.replaceChildren();
    $('order-status').textContent = '';
    $('order-empty').hidden = points.length > 0;
    points.forEach((point, index) => {
      const row = document.createElement('li');
      row.className = 'order-row';
      row.dataset.index = index;
      row.draggable = true;
      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.textContent = '⠿';
      handle.setAttribute('aria-hidden', 'true');
      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'order-title';
      title.textContent = `${index + 1}. ${point.title}`;
      title.onclick = () => openEditor(index);
      row.append(handle, title);
      for (const [offset, label, symbol] of [[-1, 'Выше', '↑'], [1, 'Ниже', '↓']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = symbol;
        button.dataset.offset = offset;
        button.setAttribute('aria-label', `${label}: ${point.title}`);
        button.disabled = index + offset < 0 || index + offset >= points.length;
        button.onclick = () => {
          if (reorder(index, index + offset)) {
            const moved = list.children[index + offset];
            const control = moved.querySelector(`[data-offset="${offset}"]`);
            (control.disabled ? moved.querySelector('.order-title') : control).focus();
          }
        };
        row.append(button);
      }
      row.ondragstart = event => {
        dragged = index;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
        row.classList.add('dragging');
      };
      row.ondragover = event => {
        if (dragged === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.add('drop-target');
      };
      row.ondragleave = () => row.classList.remove('drop-target');
      row.ondrop = event => {
        event.preventDefault();
        row.classList.remove('drop-target');
        if (dragged !== null) reorder(dragged, index);
        dragged = null;
      };
      row.ondragend = () => {
        dragged = null;
        list.querySelectorAll('li').forEach(el => el.classList.remove('dragging', 'drop-target'));
      };
      list.append(row);
    });
  }

  function reorder(from, to) {
    if (!ready || !editing || from === to || !points[from] || !points[to]) return false;
    const next = points.slice(), active = points[selected], previous = selected;
    next.splice(to, 0, next.splice(from, 1)[0]);
    selected = next.indexOf(active);
    if (!save(next)) { selected = previous; return false; }
    $('order-status').textContent = `Точка «${next[to].title}»: место ${to + 1} из ${next.length}.`;
    return true;
  }

  $('points-download').onclick = () => {
    if (!ready || !editing) return;
    const data = {format: 'object-notes', version: 1, modelId: model.id, points};
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${model.id}-points.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('points-upload').onclick = () => { if (ready && editing) { upload.value = ''; upload.click(); } };
  upload.onchange = async () => {
    const file = upload.files[0], current = generation;
    if (!file || !ready || !editing) return;
    let data;
    try {
      data = JSON.parse(await file.text());
      if (!data || data.format !== 'object-notes' || data.version !== 1 ||
          typeof data.modelId !== 'string' || !Array.isArray(data.points) || !data.points.every(valid)) {
        throw new Error('Invalid annotation file');
      }
    } catch { notify('Не удалось загрузить точки: файл повреждён или имеет неподдерживаемый формат.'); return; }
    if (!ready || !editing || current !== generation) { notify('Режим или модель изменились. Выберите файл заново.'); return; }
    if (data.modelId !== model.id) { notify('Этот файл относится к другой модели. Сначала выберите соответствующую модель.'); return; }
    if (!window.confirm(`Заменить все текущие точки (${points.length}) точками из файла (${data.points.length})? Для резервной копии текущих точек нажмите «Отмена», затем «Скачать точки».`)) return;
    const next = data.points.map(p => ({title: p.title, description: p.description, position: p.position,
      ...(p.view ? {view: {position: p.view.position, target: p.view.target}} : {})}));
    const previous = {selected, touring};
    selected = -1; touring = false;
    if (save(next)) {
      fit(getRoot(), true);
      notify(`Загружено точек: ${points.length}. Порядок экскурсии восстановлен.`);
    } else { selected = previous.selected; touring = previous.touring; }
  };

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
    if (!ready || !editing) return false;
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
    if (!ready || !editing) return;
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
    if (!ready || !editing || !draft) return;
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
    if (!ready || !editing || !draft || selected < 0) return;
    const index = selected;
    selected = -1;
    if (save(points.filter((_, i) => i !== index))) dialog.close();
    else selected = index;
  };
  edit.onclick = () => {
    if (!ready) return;
    if (editing) {
      generation++; editing = false; selected = -1; dialog.close(); refresh();
      return;
    }
    accessCode.value = '';
    $('access-error').textContent = '';
    accessDialog.showModal();
    accessCode.focus();
  };
  accessForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!ready || !accessDialog.open) return;
    if (accessCode.value !== EDITOR_ACCESS_CODE) {
      $('access-error').textContent = 'Неверный код доступа.';
      accessCode.select();
      return;
    }
    touring = false; editing = true; selected = -1;
    accessDialog.close(); refresh();
  });
  $('access-cancel').onclick = () => accessDialog.close();
  accessDialog.addEventListener('close', () => { accessCode.value = ''; $('access-error').textContent = ''; });
  start.onclick = () => {
    if (!ready || !points.length) return;
    generation++; editing = false; touring = true; dialog.close(); refresh(); visit(0); $('tour-next').focus();
  };
  function exitTour() {
    touring = false; selected = -1; refresh();
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
    unload() { generation++; dragged = null; ready = false; touring = false; editing = false; selected = -1; points = []; controls.enabled = true; dialog.close(); accessDialog.close(); refresh(); },
    load(config) {
      generation++; model = config; ready = true;
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

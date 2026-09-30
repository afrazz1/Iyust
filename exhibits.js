// Explicit allowlist: the cabinet frame and shelves are never toggle targets.
export const EXHIBITS = [
  ['cup', 'Сувенирная кружка'],
  ['fish', 'Сувенирная рыбка'],
  ['lighthouse', 'Маяк'],
  ['tiger_1', 'Тигр «Владивосток»'],
  ['tiger_2', 'Тигр-моряк'],
  ['tiger_plate.001', 'Тарелка «Тигр и парусник»']
];

export function exhibitControls(panel, list) {
  const visibility = new Map();
  function unload() {
    panel.hidden = true;
    panel.open = false;
    list.replaceChildren();
  }
  function load(modelId, gltf) {
    unload();
    if (modelId !== 'vitrina-1') return;
    for (const [name, title] of EXHIBITS) {
      // GLTFLoader sanitizes Blender names (including dots). Use source names.
      let object;
      gltf.scene.traverse(node => {
        const index = gltf.parser.associations.get(node)?.nodes;
        if (gltf.parser.json.nodes[index]?.name === name) object = node;
      });
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = object ? visibility.get(name) !== false : false;
      checkbox.disabled = !object;
      if (object) object.visible = checkbox.checked;
      checkbox.onchange = () => {
        if (!object) return;
        object.visible = checkbox.checked;
        visibility.set(name, checkbox.checked);
      };
      const text = document.createElement('span');
      text.textContent = title;
      label.append(checkbox, text);
      list.append(label);
    }
    panel.hidden = false;
  }
  return {load, unload};
}

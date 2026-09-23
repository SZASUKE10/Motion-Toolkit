(() => {
  const csInterface = new CSInterface();
  const escapeExtendScriptString = window.MotionToolkitUtil.escapeForEvalScript;
  const defaultSearchFilters = [
    { label: 'nep_', query: 'nep_' }
  ];
  const accentDefinitions = [
    { key: 'text', matches: (name) => /text|title|type|caption|word/i.test(name) },
    { key: 'utility', matches: (name) => /utility|reveal|fade|opacity|color|blur/i.test(name) },
    { key: 'motion', matches: (name) => /ease|move|motion|drift|overshoot|bounce|slide|scale|rotate|position/i.test(name) }
  ];

  document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.querySelector('.preset-search-input');
    const filterContainer = document.querySelector('.preset-filters');
    const presetList = document.querySelector('.preset-list');
    const count = document.querySelector('[data-preset-count]');
    const builtinsToggle = document.querySelector('.browser-builtins-toggle');
    const savedFilters = document.querySelector('.saved-search-filters');
    const addFilterButton = document.querySelector('.add-search-filter');
    const filterForm = document.querySelector('.search-filter-form');
    const filterLabelInput = document.querySelector('.filter-label-input');
    const filterQueryInput = document.querySelector('.filter-query-input');
    const cancelFilterButton = document.querySelector('.cancel-search-filter');
    let presets = [];
    let showBuiltins = false;
    let builtinsLoaded = false;
    let projectPresetsLoaded = false;
    let activeSearchFilter = '';
    let searchFilters = loadSearchFilters();

    function getCategory(name) {
      const definition = accentDefinitions.find((filter) => filter.matches(name));
      return definition ? definition.key : 'motion';
    }

    function loadSearchFilters() {
      try {
        const storedFilters = JSON.parse(localStorage.getItem('motionToolkitSearchFilters'));
        if (Array.isArray(storedFilters) && storedFilters.length > 0) {
          return storedFilters.filter((filter) => filter.label && filter.query);
        }
      } catch (error) {
        console.warn('Could not load saved search filters:', error);
      }
      return defaultSearchFilters.slice();
    }

    function saveSearchFilters() {
      localStorage.setItem('motionToolkitSearchFilters', JSON.stringify(searchFilters));
    }

    function createFilterButtons() {
      filterContainer.replaceChildren();

      const allButton = document.createElement('button');
      allButton.className = 'preset-filter';
      allButton.type = 'button';
      allButton.textContent = 'All';
      allButton.addEventListener('click', () => {
        activeSearchFilter = '';
        searchInput.value = '';
        updateFilterButtonState(allButton);
        updatePresets();
      });
      filterContainer.appendChild(allButton);

      searchFilters.forEach((filter) => {
        const button = document.createElement('button');
        button.className = 'preset-filter';
        button.type = 'button';
        button.dataset.query = filter.query;
        button.textContent = filter.label;
        button.addEventListener('click', () => {
          activeSearchFilter = filter.query;
          searchInput.value = filter.query;
          updateFilterButtonState(button);
          updatePresets();
        });
        filterContainer.appendChild(button);
      });

      const activeButton = Array.from(filterContainer.querySelectorAll('.preset-filter'))
        .find((button) => button.dataset.query === activeSearchFilter);
      updateFilterButtonState(activeButton || allButton);
    }

    function updateFilterButtonState(activeButton) {
      filterContainer.querySelectorAll('.preset-filter').forEach((button) => {
        button.classList.toggle('active', button === activeButton);
      });
    }

    function createPresetItem(preset) {
      const item = document.createElement('button');
      const swatch = document.createElement('span');
      const details = document.createElement('span');
      const title = document.createElement('strong');
      const metadata = document.createElement('small');
      const arrow = document.createElement('span');

      item.className = 'preset-item';
      item.type = 'button';
      item.dataset.presetName = preset.name.toLowerCase();
      item.dataset.category = preset.category;
      item.addEventListener('click', () => applyPreset(preset.path));

      swatch.className = `preset-swatch swatch-${preset.category}`;
      swatch.setAttribute('aria-hidden', 'true');
      title.textContent = preset.name;
      metadata.textContent = `${preset.category} • FFX preset`;
      arrow.className = 'item-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';

      details.append(title, metadata);
      item.append(swatch, details, arrow);
      return item;
    }

    function applyPreset(presetPath) {
      csInterface.evalScript(`applyFfxPreset("${escapeExtendScriptString(presetPath)}")`, (result) => {
        if (result && result.indexOf('EvalScript error') !== -1) {
          console.error('Failed to apply preset:', result);
        }
      });
    }

    function parsePresetResult(result, isBuiltIn) {
      // ExtendScript's File/Folder objects can themselves return .name/.fsName
      // with spaces (and other characters) percent-encoded - that's a quirk
      // of the File API itself, not something host/modules/preset-browser.jsx
      // does on purpose, so it has to be undone here. decodeURIComponent alone
      // (no "+"-to-space step - that's a form-encoding convention, not how
      // percent-encoding represents space, and it was wrongly turning a literal
      // "+" in a preset name into a space) correctly reverses it.
      function decodeDisplayText(value) {
        try {
          return decodeURIComponent(value);
        } catch (error) {
          return value;
        }
      }

      return (result || '').split('\n')
        .map((record) => record.trim())
        .filter(Boolean)
        .map((record) => {
          const separator = record.indexOf('\t');
          const rawFileName = separator === -1 ? record : record.slice(0, separator);
          const remaining = separator === -1 ? '' : record.slice(separator + 1);
          const pathSeparator = remaining.indexOf('\t');
          const filePath = pathSeparator === -1 ? remaining : remaining.slice(0, pathSeparator);
          const rawFolderPath = pathSeparator === -1 ? '' : remaining.slice(pathSeparator + 1);
          const fileName = decodeDisplayText(rawFileName);
          return {
            name: fileName.replace(/\.ffx$/i, ''),
            path: filePath,
            folderPath: decodeDisplayText(rawFolderPath),
            category: getCategory(fileName),
            isBuiltIn
          };
        });
    }

    function getVisiblePresets() {
      return presets.filter((preset) => showBuiltins || !preset.isBuiltIn);
    }

    function createPresetFolder(label, sourcePresets) {
      const total = sourcePresets.length;
      const folder = document.createElement('div');
      const folderHeader = document.createElement('button');
      const folderTitle = document.createElement('span');
      const folderCount = document.createElement('span');
      const folderContent = document.createElement('div');

      // "preset-nested-folder" is also what gives each AE Built-ins folder its
      // collapse chevron and toggle behavior in browser.css - it's the only
      // collapsible-folder styling defined, so this folder reuses it even
      // though it isn't actually nested under anything (--folder-depth is
      // simply left unset, which the CSS already treats as 0).
      folder.className = 'preset-source preset-nested-folder';
      folderHeader.className = 'preset-folder';
      folderHeader.type = 'button';
      folderHeader.setAttribute('aria-expanded', 'true');
      folderTitle.innerHTML = `<span class="folder-mark" aria-hidden="true"></span><span><strong>${label}</strong><small>${total} FFX preset${total === 1 ? '' : 's'}</small></span>`;
      folderCount.className = 'item-count';
      folderCount.textContent = String(total).padStart(2, '0');

      folderHeader.append(folderTitle, folderCount);
      folderContent.className = 'preset-folder-content';
      sourcePresets.forEach((preset) => folderContent.appendChild(createPresetItem(preset)));

      folderHeader.addEventListener('click', () => {
        const wasExpanded = folderHeader.getAttribute('aria-expanded') === 'true';
        folderHeader.setAttribute('aria-expanded', String(!wasExpanded));
        folderContent.hidden = wasExpanded;
        folder.classList.toggle('is-collapsed', wasExpanded);
      });

      folder.append(folderHeader, folderContent);
      return folder;
    }

    function createBuiltinTree(sourcePresets) {
      const root = { label: 'AE Built-ins', presets: [], children: new Map() };
      sourcePresets.forEach((preset) => {
        const parts = (preset.folderPath || 'General').split('/').filter(Boolean);
        let node = root;
        parts.forEach((part) => {
          if (!node.children.has(part)) {
            node.children.set(part, { label: part, presets: [], children: new Map() });
          }
          node = node.children.get(part);
        });
        node.presets.push(preset);
      });

      function countNode(node) {
        return node.presets.length + Array.from(node.children.values())
          .reduce((sum, child) => sum + countNode(child), 0);
      }

      function renderNode(node, depth) {
        const wrapper = document.createElement('div');
        const header = document.createElement('button');
        const title = document.createElement('span');
        const count = document.createElement('span');
        const content = document.createElement('div');
        const total = countNode(node);

        wrapper.className = 'preset-source preset-nested-folder';
        wrapper.style.setProperty('--folder-depth', depth);
        header.className = 'preset-folder';
        header.type = 'button';
        header.setAttribute('aria-expanded', 'true');
        title.innerHTML = `<span class="folder-mark" aria-hidden="true"></span><span><strong>${node.label}</strong><small>${total} FFX preset${total === 1 ? '' : 's'}</small></span>`;
        count.className = 'item-count';
        count.textContent = String(total).padStart(2, '0');
        header.append(title, count);
        content.className = 'preset-folder-content';
        node.presets.forEach((preset) => content.appendChild(createPresetItem(preset)));
        Array.from(node.children.values()).sort((left, right) => left.label.localeCompare(right.label))
          .forEach((child) => content.appendChild(renderNode(child, depth + 1)));
        header.addEventListener('click', () => {
          const collapsed = header.getAttribute('aria-expanded') === 'true';
          header.setAttribute('aria-expanded', String(!collapsed));
          content.hidden = collapsed;
          wrapper.classList.toggle('is-collapsed', collapsed);
        });
        wrapper.append(header, content);
        return wrapper;
      }

      return renderNode(root, 0);
    }

    function renderPresets() {
      presetList.replaceChildren();
      const visiblePresets = getVisiblePresets();

      if (visiblePresets.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'preset-empty';
        emptyState.textContent = showBuiltins
          ? 'No .ffx presets found in the preset folders'
          : 'No project .ffx presets found in preset/ffx';
        presetList.appendChild(emptyState);
        return;
      }

      const projectPresets = visiblePresets.filter((preset) => !preset.isBuiltIn);
      const builtinPresets = visiblePresets.filter((preset) => preset.isBuiltIn);

      if (projectPresets.length > 0) {
        presetList.appendChild(createPresetFolder('Project Presets', projectPresets));
      }
      if (builtinPresets.length > 0) {
        presetList.appendChild(createBuiltinTree(builtinPresets));
      }
    }

    function updatePresets() {
      const query = searchInput.value.trim().toLowerCase();
      let visibleCount = 0;

      presetList.querySelectorAll('[data-preset-name]').forEach((item) => {
        const matchesQuery = item.dataset.presetName.includes(query);
        const isVisible = matchesQuery;

        item.hidden = !isVisible;
        if (isVisible) visibleCount += 1;
      });

      // A folder (Project Presets, or any node in the AE Built-ins tree) with
      // no visible preset left inside it gets hidden too - otherwise a search
      // left a trail of empty folder headers with nothing under them.
      // querySelectorAll('.preset-item') reaches every level of nesting, so
      // this reads each folder's own leaf state directly rather than relying
      // on child folders having already been resolved.
      presetList.querySelectorAll('.preset-source').forEach((folder) => {
        const hasVisibleItem = Array.from(folder.querySelectorAll('.preset-item')).some((item) => !item.hidden);
        folder.hidden = !hasVisibleItem;
      });

      count.textContent = `${String(visibleCount).padStart(2, '0')} PRESETS`;
    }

    function scanPresetFolder() {
      if (projectPresetsLoaded) return;
      projectPresetsLoaded = true;
      const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
      const modulePath = `${extensionPath}/host/modules/preset-browser.jsx`.replace(/\\/g, '/');
      const presetPath = `${extensionPath}/preset/ffx`.replace(/\\/g, '/');

      csInterface.evalScript(`$.evalFile("${modulePath}")`, (loadResult) => {
        if (loadResult && loadResult.indexOf('EvalScript error') !== -1) {
          count.textContent = 'SCAN ERROR';
          return;
        }

        csInterface.evalScript(`listFfxPresets("${presetPath}")`, (result) => {
          if (result && result.indexOf('EvalScript error') !== -1) {
            count.textContent = 'SCAN ERROR';
            return;
          }

          const projectPresets = parsePresetResult(result, false);

          presets = projectPresets;
          renderPresets();
          updatePresets();
        });
      });
    }

    function scanBuiltinPresets() {
      count.textContent = 'SCANNING AE...';
      csInterface.evalScript('listAeBuiltinPresets()', (builtinResult) => {
        if (builtinResult && builtinResult.indexOf('EvalScript error') !== -1) {
          builtinsLoaded = false;
          presetList.replaceChildren();
          const errorState = document.createElement('div');
          errorState.className = 'preset-empty';
          errorState.textContent = 'Could not scan AE Presets/Animation Presets';
          presetList.appendChild(errorState);
          count.textContent = 'AE SCAN ERROR';
          return;
        }

        if (builtinResult === '__AE_ANIMATION_PRESETS_FOLDER_NOT_FOUND__') {
          builtinsLoaded = false;
          presetList.replaceChildren();
          const missingFolderState = document.createElement('div');
          missingFolderState.className = 'preset-empty';
          missingFolderState.textContent = 'After Effects Presets folder was not found';
          presetList.appendChild(missingFolderState);
          count.textContent = 'AE FOLDER NOT FOUND';
          return;
        }

        const builtinPresets = parsePresetResult(builtinResult, true);

        presets = presets.filter((preset) => !preset.isBuiltIn).concat(builtinPresets);
        builtinsLoaded = true;
        renderPresets();
        updatePresets();
      });
    }

    searchInput.addEventListener('input', () => {
      activeSearchFilter = '';
      filterContainer.querySelectorAll('.preset-filter').forEach((button) => button.classList.remove('active'));
      updatePresets();
    });

    addFilterButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      filterForm.hidden = false;
      filterLabelInput.focus();
    });

    cancelFilterButton.addEventListener('click', () => {
      filterForm.reset();
      filterForm.hidden = true;
    });

    filterForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const label = filterLabelInput.value.trim();
      const query = filterQueryInput.value.trim();
      if (!label || !query) return;

      searchFilters.push({ label, query });
      saveSearchFilters();
      createFilterButtons();
      renderSavedFilters();
      filterForm.reset();
      filterForm.hidden = true;
    });

    builtinsToggle.addEventListener('click', () => {
      showBuiltins = !showBuiltins;
      builtinsToggle.setAttribute('aria-pressed', String(showBuiltins));
      if (showBuiltins && !builtinsLoaded) {
        scanBuiltinPresets();
        return;
      }
      renderPresets();
      updatePresets();
    });

    window.addEventListener('motion-toolkit-tab-change', (event) => {
      if (event.detail && event.detail.tab === 'Preset') scanPresetFolder();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && document.activeElement !== searchInput) {
        event.preventDefault();
        searchInput.focus();
      }
    });

    function renderSavedFilters() {
      savedFilters.replaceChildren();
      searchFilters.forEach((filter, index) => {
        const row = document.createElement('div');
        const details = document.createElement('span');
        const label = document.createElement('strong');
        const query = document.createElement('small');
        const removeButton = document.createElement('button');

        row.className = 'saved-filter-row';
        label.textContent = filter.label;
        query.textContent = filter.query;
        removeButton.type = 'button';
        removeButton.className = 'remove-search-filter';
        removeButton.setAttribute('aria-label', `Remove ${filter.label}`);
        removeButton.textContent = '×';
        removeButton.addEventListener('click', () => {
          searchFilters.splice(index, 1);
          saveSearchFilters();
          if (activeSearchFilter === filter.query) {
            activeSearchFilter = '';
            searchInput.value = '';
            updatePresets();
          }
          createFilterButtons();
          renderSavedFilters();
        });

        details.append(label, query);
        row.append(details, removeButton);
        savedFilters.appendChild(row);
      });
    }

    createFilterButtons();
    renderSavedFilters();
  });
})();

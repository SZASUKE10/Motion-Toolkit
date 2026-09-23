(() => {
  const STORAGE_KEY = 'motionToolkitDiscordRPC';
  const RECONNECT_DELAY_MS = 10000;
  const HEARTBEAT_MS = 30000;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error('Could not save Discord RPC settings:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const panel = document.querySelector('[data-discord-panel]');
    if (!panel) return;

    const fields = {
      enabled: panel.querySelector('[data-discord-enabled]'),
      clientId: panel.querySelector('[data-discord-client-id]'),
      details: panel.querySelector('[data-discord-details]'),
      state: panel.querySelector('[data-discord-state]'),
      largeImage: panel.querySelector('[data-discord-large-image]'),
      largeText: panel.querySelector('[data-discord-large-text]'),
      smallImage: panel.querySelector('[data-discord-small-image]'),
      smallText: panel.querySelector('[data-discord-small-text]'),
      elapsed: panel.querySelector('[data-discord-elapsed]'),
      btn1Label: panel.querySelector('[data-discord-btn1-label]'),
      btn1Url: panel.querySelector('[data-discord-btn1-url]'),
      btn2Label: panel.querySelector('[data-discord-btn2-label]'),
      btn2Url: panel.querySelector('[data-discord-btn2-url]'),
    };
    const saveButton = panel.querySelector('[data-discord-save]');
    const statusLabel = panel.querySelector('[data-discord-status]');

    function applySettingsToFields(settings) {
      fields.enabled.checked = !!settings.enabled;
      fields.clientId.value = settings.clientId || '';
      fields.details.value = settings.details || '';
      fields.state.value = settings.state || '';
      fields.largeImage.value = settings.largeImage || '';
      fields.largeText.value = settings.largeText || '';
      fields.smallImage.value = settings.smallImage || '';
      fields.smallText.value = settings.smallText || '';
      fields.elapsed.checked = settings.elapsed !== false;
      fields.btn1Label.value = settings.btn1Label || '';
      fields.btn1Url.value = settings.btn1Url || '';
      fields.btn2Label.value = settings.btn2Label || '';
      fields.btn2Url.value = settings.btn2Url || '';
    }

    function readFields() {
      return {
        enabled: fields.enabled.checked,
        clientId: fields.clientId.value.trim(),
        details: fields.details.value.trim(),
        state: fields.state.value.trim(),
        largeImage: fields.largeImage.value.trim(),
        largeText: fields.largeText.value.trim(),
        smallImage: fields.smallImage.value.trim(),
        smallText: fields.smallText.value.trim(),
        elapsed: fields.elapsed.checked,
        btn1Label: fields.btn1Label.value.trim(),
        btn1Url: fields.btn1Url.value.trim(),
        btn2Label: fields.btn2Label.value.trim(),
        btn2Url: fields.btn2Url.value.trim(),
      };
    }

    applySettingsToFields(loadSettings());

    let ipc = null;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let startTimestamp = Date.now();

    function setStatus(text, state) {
      if (!statusLabel) return;
      statusLabel.textContent = text;
      statusLabel.dataset.state = state || '';
    }

    function currentTabDetails() {
      const activeTab = document.querySelector('.nav-item.active');
      const tabName = activeTab ? activeTab.getAttribute('data-tab') : '';
      if (tabName === 'Graph') return 'Editing keyframes';
      if (tabName === 'Preset') return 'Browsing presets';
      if (tabName === 'Misc') return 'In the Misc tab';
      if (tabName === 'Settings') return 'In Settings';
      return 'Using Motion Toolkit';
    }

    function buildActivity(current) {
      const activity = {
        details: current.details || currentTabDetails(),
      };
      if (current.state) activity.state = current.state;
      if (current.elapsed !== false) activity.timestamps = { start: startTimestamp };

      if (current.largeImage || current.smallImage) {
        activity.assets = {};
        if (current.largeImage) {
          activity.assets.large_image = current.largeImage;
          if (current.largeText) activity.assets.large_text = current.largeText;
        }
        if (current.smallImage) {
          activity.assets.small_image = current.smallImage;
          if (current.smallText) activity.assets.small_text = current.smallText;
        }
      }

      const buttons = [];
      if (current.btn1Label && current.btn1Url) buttons.push({ label: current.btn1Label, url: current.btn1Url });
      if (current.btn2Label && current.btn2Url) buttons.push({ label: current.btn2Label, url: current.btn2Url });
      if (buttons.length) activity.buttons = buttons;

      return activity;
    }

    function clearTimers() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }

    function stopConnection(statusText) {
      clearTimers();
      if (ipc) {
        ipc.clearActivity();
        ipc.disconnect();
        ipc = null;
      }
      setStatus(statusText || 'Disabled', '');
    }

    function scheduleReconnect() {
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startConnection(readFields());
      }, RECONNECT_DELAY_MS);
    }

    function startConnection(current) {
      clearTimers();

      if (!current.enabled) {
        stopConnection('Disabled');
        return;
      }
      if (!current.clientId) {
        setStatus('Add a Client ID to connect', 'error');
        return;
      }
      if (typeof require !== 'function') {
        setStatus('Node.js not enabled for this panel', 'error');
        return;
      }

      setStatus('Connecting...', '');
      startTimestamp = Date.now();

      const DiscordIPC = window.MotionToolkitDiscordIPC;
      const client = new DiscordIPC();
      ipc = client;

      client.onError = () => {
        if (ipc !== client) return;
        setStatus('Discord not found - retrying', 'error');
        scheduleReconnect();
      };
      client.onClose = () => {
        if (ipc !== client) return;
        setStatus('Disconnected - retrying', 'error');
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        scheduleReconnect();
      };

      client.connect(current.clientId).then(() => {
        if (ipc !== client) return;
        setStatus('Connected', 'connected');
        client.setActivity(buildActivity(current));
        heartbeatTimer = setInterval(() => {
          client.setActivity(buildActivity(readFields()));
        }, HEARTBEAT_MS);
      }).catch(() => {
        if (ipc !== client) return;
        setStatus('Discord not found - retrying', 'error');
        scheduleReconnect();
      });
    }

    saveButton.addEventListener('click', () => {
      const current = readFields();
      saveSettings(current);
      startConnection(current);
    });

    document.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        const current = readFields();
        if (ipc && ipc.connected && !current.details) {
          setTimeout(() => ipc.setActivity(buildActivity(current)), 50);
        }
      });
    });

    const initialSettings = loadSettings();
    if (initialSettings.enabled) {
      startConnection(initialSettings);
    }

    window.addEventListener('beforeunload', () => {
      if (ipc) {
        ipc.clearActivity();
        ipc.disconnect();
      }
    });
  });
})();

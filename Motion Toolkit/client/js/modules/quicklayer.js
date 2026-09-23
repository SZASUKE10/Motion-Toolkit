(() => {
	const csInterface = new CSInterface();

	function loadQuickLayerModule() {
		const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
		const scriptPath = (extensionPath + '/host/modules/quicklayer.jsx').replace(/\\/g, '/');

		csInterface.evalScript(`$.evalFile("${scriptPath}")`, (result) => {
			if (result && result.indexOf('EvalScript error') !== -1) {
				console.error('Failed to load quicklayer.jsx:', result, scriptPath);
			}
		});
	}

	document.addEventListener('DOMContentLoaded', () => {
		loadQuickLayerModule();

		document.body.addEventListener('click', (event) => {
			const button = event.target.closest('.quick-layer');
			if (!button) return;

			const layerType = button.getAttribute('data-quicklayer');
			const parentSelected = document.querySelector('.toggle-parent').checked;
			const make3D = document.querySelector('.toggle-3d').checked;

			if (layerType) {
				const script = `createQuickLayer("${layerType}", ${parentSelected}, ${make3D})`;
				csInterface.evalScript(script, (result) => {
					if (result && result.indexOf('EvalScript error') !== -1) {
						console.error('createQuickLayer failed:', result);
					}
				});
			}
		});
	});
})();

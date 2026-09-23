(() => {
	const csInterface = new CSInterface();

	function loadOrganizeModule() {
		const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
		const scriptPath = (extensionPath + '/host/modules/organize.jsx').replace(/\\/g, '/');

		csInterface.evalScript(`$.evalFile("${scriptPath}")`, (result) => {
			if (result && result.indexOf('EvalScript error') !== -1) {
				console.error('Failed to load organize.jsx:', result, scriptPath);
			}
		});
	}

	document.addEventListener('DOMContentLoaded', () => {
		loadOrganizeModule();

		const button = document.querySelector('[data-organize-project]');
		const resultLabel = document.querySelector('[data-organize-result]');
		if (!button) return;

		button.addEventListener('click', () => {
			button.disabled = true;
			csInterface.evalScript('organizeProject()', (result) => {
				button.disabled = false;
				if (!resultLabel) return;

				if (result && result.indexOf('EvalScript error') !== -1) {
					console.error('organizeProject failed:', result);
					resultLabel.textContent = 'Organize failed - see console.';
				} else {
					resultLabel.textContent = result ? `Moved - ${result}` : 'Nothing to organize.';
				}
				resultLabel.hidden = false;
			});
		});
	});
})();

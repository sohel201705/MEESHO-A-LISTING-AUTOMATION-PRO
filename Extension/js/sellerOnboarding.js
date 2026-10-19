(function () {
  'use strict';
  function bind() {
    const importerToggle = document.getElementById('onboard-importer-na');
    const saveButton = document.getElementById('onboard-save-continue');
    const laterButton = document.getElementById('onboard-continue-later');
    if (importerToggle && typeof toggleOnboardingImporterFields === 'function') {
      importerToggle.addEventListener('change', function () {
        toggleOnboardingImporterFields(importerToggle.checked);
      });
    }
    if (saveButton && typeof saveInitialSellerProfile === 'function') {
      saveButton.addEventListener('click', function () {
        saveInitialSellerProfile();
      });
    }
    if (laterButton && typeof saveInitialSellerProfile === 'function') {
      laterButton.addEventListener('click', function () {
        saveInitialSellerProfile();
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();

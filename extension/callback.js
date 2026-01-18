const api = typeof browser !== "undefined" ? browser : chrome;

(async function() {
  try {
    // Parse token from URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    if (!token) {
      console.error('No token found in URL');
      window.close();
      return;
    }

    // Save token to storage
    // Background script will detect this change and trigger initial poll
    await api.storage.local.set({ 
      jwt: token, 
      authError: false 
    });
    
    console.log('Token saved successfully');

    // Close this tab
    window.close();
  } catch (err) {
    console.error('Failed to save token:', err);
    window.close();
  }
})();

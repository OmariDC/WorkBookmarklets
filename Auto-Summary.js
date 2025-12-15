### CODEX PATCH: MASSIVE PERFORMANCE FIX (DEBOUNCED OBSERVER)

1. ADD GLOBAL VARIABLES NEAR TOP OF SCRIPT (below RENDER_LOCK):
   -------------------------------------------------------------
   let OBSERVER_DEBOUNCE = null;
   const OBSERVER_DELAY = 120;   // Adjust between 80–160ms for tuning

2. REPLACE initObserver() WITH THIS VERSION:
   ------------------------------------------
   function initObserver() {
     if (app.observer) return;

     app.observer = new MutationObserver(() => {
       if (OBSERVER_DEBOUNCE) clearTimeout(OBSERVER_DEBOUNCE);
       OBSERVER_DEBOUNCE = setTimeout(() => {
         safeRender(render);
       }, OBSERVER_DELAY);
     });

     app.observer.observe(document.body, {
       childList: true,
       subtree: true
     });
   }

3. REMOVE ANY DIRECT MutationObserver(render) CALLS.
   --------------------------------------------------
   (Codex: search for them and replace with the new throttled version.)

4. DO NOT MODIFY safeRender() OR THE RENDER LOCK.
   ------------------------------------------------
   The debounce runs BEFORE safeRender(), not inside it.

### END CODEX PATCH

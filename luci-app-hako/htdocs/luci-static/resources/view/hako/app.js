'use strict';
'require view';

// the entry of the app at /hako/: it shares the session of LuCI, which it
// reads from the storage of this origin, and comes back here to log in
return view.extend({
  render() {
    try {
      localStorage.setItem('hako.session', L.env.sessionid);
    } catch (e) {
      return E('p', {}, _('Hako needs the storage of the browser to open.'));
    }
    location.replace('/hako/');
    return E('p', {}, _('Opening Hako…'));
  },

  handleSave: null,
  handleSaveApply: null,
  handleReset: null
});

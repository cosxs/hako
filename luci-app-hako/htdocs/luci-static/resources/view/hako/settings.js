'use strict';
'require view';
'require hako.ui as hako';
'require form';
'require uci';

// settings of Hako itself, not of sing-box, by tabs
return view.extend({
  load() {
    return uci.load('hako');
  },

  render() {
    const m = new form.Map('hako');

    const s = m.section(form.NamedSection, 'latency', 'hako');
    s.tab('latency', _('Latency testing'));

    let o = s.taboption('latency', form.Value, 'url', _('Test URL'));
    o.description = _('Used by the latency tests of groups and nodes, and by auto groups without a test URL of their own.');
    o.placeholder = 'https://www.gstatic.com/generate_204';
    o.validate = (section_id, value) => (!value || /^https?:\/\/\S+$/.test(value)) ? true : _('Expecting an HTTP or HTTPS URL');

    o = s.taboption('latency', form.Value, 'timeout', _('Test timeout'));
    o.description = _('Outbounds without an answer by then are shown as timed out.');
    hako.duration(o, 's', _('seconds'));
    o.placeholder = '5';

    return m.render().then((mapEl) => E([], [ ...hako.header(), mapEl ]));
  }
});

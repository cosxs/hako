'use strict';
'require baseclass';
'require form';
'require dom';
'require session';
'require uci';
'require openbox.ui as openbox';
'require openbox.rules.condition as condition';

// logical rules. The dialog of a route rule has a tab for a standard rule and
// one for a logical rule, and the tab shown makes the rule of its kind. The
// rules of a logical rule are route_subrule sections naming its id, with a
// table in its dialog and dialogs of their own over it. LuCI does neither by
// itself: what it is made to do here relies on how its dialogs work, and is
// kept here

// the fields both kinds of rule have, on both tabs of the dialog, as shared()
// adds them
const SHARED = new Set();

// the name of a field of both kinds on a tab: the copy on the logical tab
// has its own
function sharedName(tab, name) {
  return (tab == 'logical') ? '_logical_' + name : name;
}

// switching tabs takes the fields both kinds have along. The event of a tab
// does not bubble, so it is caught on its way down; one for the kind the rule
// already is, as when the dialog opens, changes nothing, and so does one for
// a tab no longer shown, as the one LuCI sends for the first tab late in a
// page left in background
document.addEventListener('cbi-tab-active', (ev) => {
  if (ev.target.getAttribute?.('data-tab-active') != 'true')
    return;

  const mapNode = ev.target.closest?.('.modal .cbi-map');
  const map = mapNode ? dom.findClassInstance(mapNode) : null;
  const s = map?.children[0];
  const kind = ev.detail.tab;
  const type = s?.getUIElement(s.section, 'type');
  if (s?.sectiontype != 'route_rule' || !type || (type.getValue() == 'logical') == (kind == 'logical'))
    return;

  const from = (kind == 'logical') ? 'standard' : 'logical';
  for (const name of SHARED) {
    const source = s.getUIElement(s.section, sharedName(from, name));
    s.getUIElement(s.section, sharedName(kind, name))?.setValue(source?.getValue());
  }
  type.setValue((kind == 'logical') ? 'logical' : '');
  map.checkDepends();
}, true);

// the rules of a logical rule: the sub-rules naming its id, in order
function subrulesOf(id) {
  return id ? uci.sections(openbox.profileConfig(), 'route_subrule').filter((section) => section.rule == id) : [];
}

function removeSubrules(id) {
  subrulesOf(id).forEach((section) => uci.remove(openbox.profileConfig(), section['.name']));
}

// an id a logical rule gets when it first needs one, for its rules to name
function newId() {
  const taken = uci.sections(openbox.profileConfig(), 'route_rule').map((section) => section.id);
  let id;
  do
    id = Math.random().toString(16).slice(2, 10);
  while (taken.includes(id));

  return id;
}

// the rules of a logical rule, in its dialog: a rule added names the logical
// rule, which gets an id for it first. The dialog of the logical rule is saved
// as the dialog of the rule opens on it
const SubruleSection = form.GridSection.extend({
  handleAdd(ev, name) {
    const config = openbox.profileConfig();
    let id = uci.get(config, this.rule, 'id');
    if (!id)
      uci.set(config, this.rule, 'id', id = newId());

    // as GridSection does, with the rule named before the dialog saves
    const section_id = this.map.data.add(config, this.sectiontype, name);
    const mapNode = this.getPreviousModalMap();
    const prevMap = mapNode ? dom.findClassInstance(mapNode) : this.map;

    uci.set(config, section_id, 'rule', id);
    prevMap.addedSection = section_id;

    return this.renderMoreOptionsModal(section_id);
  },

  // new sections get their section name as the dialog of the logical rule
  // saves, on the object of the section. A new sub-rule is dismissed by that
  // name; a new logical rule, its dialog and the dialog it was added with go
  // on with it, on the tab it is on
  renderMoreOptionsModal(section_id, ev) {
    const old = this.rule;
    const ref = uci.get(openbox.profileConfig(), old);
    const subref = uci.get(openbox.profileConfig(), section_id);
    const map = this.map;

    return this.super('renderMoreOptionsModal', [ section_id, ev ]).then(() => {
      const subname = subref?.['.name'];
      if (subname && map.addedSection == section_id)
        map.addedSection = subname;

      const name = ref?.['.name'];
      if (!name || name == old)
        return;

      this.rule = map.section = map.children[0].section = name;
      if (map.parent?.addedSection == old)
        map.parent.addedSection = name;

      const state = session.getLocalData('tab');
      if (L.isObject(state?.paths) && old in state.paths) {
        state.paths[name] = state.paths[old];
        session.setLocalData('tab', state);
      }
    });
  }
});

// the rules of a logical rule as a field of its dialog, titled as the others
// with the table beside: the copy of the field in the dialog is made with the
// constructor, without the title. The rules shown are those of the rule the
// dialog is for
const SubrulesValue = form.SectionValue.extend({
  __init__(...args) {
    this.super('__init__', args);
    this.title = _('Sub-rules');
  },

  load(section_id) {
    this.subsection.rule = section_id;
    return this.super('load', [ section_id ]);
  }
});

// the section of the route rules, with their logical rules
const RuleSection = form.GridSection.extend({
  // the dialog opens on the tab of the rule: LuCI opens a tab group on the
  // tab kept for it, by its path, the name of the section here
  renderMoreOptionsModal(section_id, ...args) {
    const page = document.body.getAttribute('data-page');
    let state = session.getLocalData('tab');
    if (!L.isObject(state) || state.page !== page || !L.isObject(state.paths))
      state = { page: page, paths: {} };

    state.paths[section_id] = (uci.get(openbox.profileConfig(), section_id, 'type') == 'logical') ? 1 : 0;
    session.setLocalData('tab', state);

    return this.super('renderMoreOptionsModal', [ section_id, ...args ]);
  },

  // the rules of a logical rule go with it
  handleRemove(section_id, ev) {
    removeSubrules(uci.get(openbox.profileConfig(), section_id, 'id'));

    return this.super('handleRemove', [ section_id, ev ]);
  },

  // and with a new one dismissed; the buttons of the dialog serve the dialog
  // of a sub-rule over it as well
  handleModalCancel(modalMap, ev, isSaving) {
    const config = openbox.profileConfig();
    const prevNode = this.getPreviousModalMap();
    const added = isSaving ? null : (prevNode ? dom.findClassInstance(prevNode) : this.map).addedSection;
    if (added == null)
      return this.super('handleModalCancel', [ modalMap, ev, isSaving ]);

    // one saved already, as the dialog of a sub-rule opened, is listed;
    // removing it is saved, as a rule removed is. A sub-rule dismissed is
    // removed by LuCI, a rule with its sub-rules here
    const saved = !uci.state.creates?.[config]?.[added];
    if (!prevNode)
      removeSubrules(uci.get(config, added, 'id'));

    return Promise.resolve(this.super('handleModalCancel', [ modalMap, ev, isSaving ]))
      .then(() => !saved ? null : prevNode ? uci.save() : this.map.save(null, true));
  }
});

return baseclass.extend({
  RuleSection,

  // the rules of a logical rule as Surge shows them
  rulesText(section) {
    const rules = subrulesOf(section.id);

    return rules.length ? '%h'.format('(%s)'.format(rules.map((rule) => condition.ruleExpr(condition.ruleOf(rule))).join(', '))) : '-';
  },

  // the rule of each tab: the hidden kind, the condition of a standard rule,
  // and the mode and rules of a logical rule
  options(rs) {
    const config = openbox.profileConfig();

    // the kind of a rule: logical, or empty for a standard rule, as the tab
    // shown; a logical rule keeps no conditions of its own
    let o = rs.taboption('standard', form.HiddenValue, 'type');
    o.modalonly = true;
    o.write = function (section_id, value) {
      condition.MATCH_KEYS.forEach((key) => uci.unset(config, section_id, key));
      uci.set(config, section_id, 'type', value);
    };

    // a standard rule: a type and its value. A logical rule turned standard
    // leaves its mode and its rules
    condition.options((widget, name, title) => rs.taboption('standard', widget, name, title), {
      depends: { type: '' },
      skip: (option, section_id) => option.section.formvalue(section_id, 'type') == 'logical',
      clear: (section_id) => {
        removeSubrules(uci.get(config, section_id, 'id'));
        [ 'mode', 'rules', 'id' ].forEach((key) => uci.unset(config, section_id, key));
      }
    });

    // a logical rule: its mode and its rules, each a rule of its own with a
    // type and its value, or JSON; the action is the one of this rule
    o = rs.taboption('logical', form.ListValue, 'mode', _('Mode'));
    o.value('and');
    o.value('or');
    o.description = _('and: all the sub-rules match; or: any of them does.');
    o.modalonly = true;
    o.rmempty = false;
    o.depends('type', 'logical');

    o = rs.taboption('logical', SubrulesValue, '_subrules', SubruleSection, 'route_subrule');
    o.modalonly = true;
    o.depends('type', 'logical');

    const ss = o.subsection;
    ss.anonymous = true;
    ss.addremove = true;
    ss.sortable = true;
    ss.nodescriptions = true;
    ss.modaltitle = _('Sub-rule');
    ss.filter = function (section_id) {
      const id = uci.get(config, this.rule, 'id');
      return id != null && uci.get(config, section_id, 'rule') == id;
    };

    let so = ss.option(form.DummyValue, '_type', _('Type'));
    so.modalonly = false;
    so.textvalue = (section_id) => condition.typeText(uci.get(config, section_id) ?? {});

    so = ss.option(form.DummyValue, '_value', _('Value'));
    so.modalonly = false;
    so.textvalue = (section_id) => condition.valueCell(uci.get(config, section_id) ?? {});

    condition.options((widget, name, title) => ss.option(widget, name, title), { json: true });

    // switched in the table as well
    so = ss.option(form.Flag, 'invert', _('Invert'));
    so.description = _('The sub-rule matches when its condition does not.');
    so.editable = true;
  },

  // a field both kinds have: a copy on each tab, so that neither tab is
  // ever empty and hidden; only the copy of the kind the rule is saved as
  // writes. setup is given the copy, and the name of another such field on
  // its tab
  shared(rs, name, widget, title, setup) {
    SHARED.add(name);

    for (const tab of [ 'standard', 'logical' ]) {
      const copy = rs.taboption(tab, widget, sharedName(tab, name), title);
      copy.ucioption = name;
      copy.modalonly = true;
      setup(copy, (other) => sharedName(tab, other));

      for (const fn of [ 'write', 'remove' ]) {
        const original = copy[fn];
        copy[fn] = function (section_id, ...args) {
          if ((this.section.formvalue(section_id, 'type') == 'logical') == (tab == 'logical'))
            return original.call(this, section_id, ...args);
        };
      }
    }
  }
});

'use strict';
'require baseclass';
'require form';
'require uci';

// sing-box fields written as JSON, such as the TLS or dial fields of a node:
// a box on a tab of a dialog, taken by the generator as it is

// an object, or nothing
function validate(section_id, value) {
  if (!value?.trim())
    return true;

  try {
    return L.isObject(JSON.parse(value)) ? true : _('Expecting a JSON object');
  }
  catch (e) {
    return _('Invalid JSON: %s').format(e.message);
  }
}

// rules as sing-box takes them, with conditions only: an array of objects,
// or one object
function validateRules(section_id, value) {
  if (!value?.trim())
    return true;

  try {
    const rules = JSON.parse(value);
    return (Array.isArray(rules) ? rules : [ rules ]).every((rule) => L.isObject(rule)) ? true : _('Expecting an array of rules');
  }
  catch (e) {
    return _('Invalid JSON: %s').format(e.message);
  }
}

// the fields, null unless an object
function parse(value) {
  try {
    const fields = JSON.parse(value || '{}');
    return L.isObject(fields) ? fields : null;
  }
  catch (e) {
    return null;
  }
}

function format(fields) {
  const text = JSON.stringify(fields, null, 2);
  return (text == '{}') ? '' : text;
}

return baseclass.extend({
  validate,
  validateRules,
  parse,
  format,

  // the box of fields named name, after the options of the section that
  // edit some of them: bind maps each of those to [ read it from the
  // fields, write it into them ], and they follow the box both ways, the box
  // being what counts. base gives the fields that a write starts from.
  // Stored options keep values of their own, the box going over them; the
  // others keep nothing and show what the box has
  add(s, tab, name, title, description, { placeholder, bind = {}, base = () => ({}), stored = false } = {}) {
    // the options into the box; JSON being typed that is not valid is left
    // alone
    const toFields = function (ev, section_id) {
      const box = this.section.getUIElement(section_id, name);
      const parsed = box ? parse(box.getValue()) : null;
      if (!parsed)
        return;

      const fields = { ...base(), ...parsed };
      for (const option of this.section.children)
        if (option.option in bind && option.isActive(section_id))
          bind[option.option][1](fields, option.formvalue(section_id));

      box.setValue(format(fields));
    };

    for (const option of s.children.filter((option) => option.option in bind)) {
      option.onchange = toFields;
      if (stored)
        continue;

      option.cfgvalue = function (section_id) {
        return bind[this.option][0](parse(uci.get(this.map.config, section_id, name)) ?? {});
      };
      option.write = option.remove = () => {};
    }

    const o = s.taboption(tab, form.TextValue, name, title);
    o.description = description;
    o.rows = 6;
    o.monospace = true;
    o.placeholder = placeholder;
    o.modalonly = true;
    o.validate = validate;
    // and back, once the box is edited
    o.onchange = function (ev, section_id) {
      const fields = parse(this.section.getUIElement(section_id, name)?.getValue());
      if (!fields)
        return;

      for (const [option, [read]] of Object.entries(bind))
        this.section.getUIElement(section_id, option)?.setValue(read(fields));

      this.section.map.checkDepends();
    };
    // with stored options, one saved before the box was shows them. Also
    // called with the value loaded, which the section stores
    o.cfgvalue = function (section_id) {
      const value = form.TextValue.prototype.cfgvalue.apply(this, arguments);
      if (value || !stored)
        return value;

      const fields = base();
      for (const [option, [, write]] of Object.entries(bind))
        write(fields, uci.get(this.map.config, section_id, option));

      return format(fields);
    };

    return o;
  }
});

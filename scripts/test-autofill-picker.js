const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');
const vm = require('vm');

const source = fs.readFileSync('src/main/services/autofill-picker.ts', 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2018,
  },
}).outputText;
const moduleRef = { exports: {} };

vm.runInNewContext(`(function(require,module,exports){${output}\n})`, {})(
  () => ({}),
  moduleRef,
  moduleRef.exports,
);

const buildAutofillPickerCode = moduleRef.exports.buildAutofillPickerCode;
const code = buildAutofillPickerCode(
  [
    {
      _id: 'credential-1',
      type: 'password',
      url: 'example.com',
      fields: { username: 'user@example.com', password: 'secret' },
    },
  ],
  { captureToken: 'capture-token', fillSingleImmediately: true },
);

assert.doesNotThrow(() => new Function(code));
assert.match(code, /fillSingleImmediately/);
assert.match(code, /isLoginForm/);
assert.match(code, /new-password/);
assert.match(code, /userEditedSignatures/);

const probeCode = buildAutofillPickerCode(
  [
    {
      _id: 'credential-1',
      type: 'password',
      url: 'example.com',
      fields: { username: 'user@example.com', password: 'secret' },
    },
  ],
  { bind: false, showImmediately: true, fillSingleImmediately: true },
);

const runPicker = ({
  hostname,
  pathname,
  formId,
  passwordAutocomplete = 'new-password',
  backgroundRegistration = false,
  netEaseMirror = false,
  submitLabel = '',
  formAction = '',
}) => {
  const attributes = (values) => ({
    type: values.type || 'text',
    value: '',
    offsetWidth: 200,
    offsetHeight: 40,
    form: null,
    getAttribute(name) {
      return values[name] || '';
    },
    dispatchEvent() {},
  });
  const username = attributes({
    type: 'text',
    id: 'username',
    name: 'username',
    class: netEaseMirror ? 'j-inputtext dlemail' : '',
    'data-loginname': netEaseMirror ? 'loginEmail' : '',
    placeholder: '手机号/邮箱/用户名',
    autocomplete: 'off',
  });
  const password = attributes({
    type: 'password',
    id: 'password',
    name: 'password',
    class: netEaseMirror ? 'j-inputtext dlpwd' : '',
    'data-loginname': netEaseMirror ? 'loginPassword' : '',
    placeholder: '登录密码',
    autocomplete: passwordAutocomplete,
  });
  const passwordMirror = attributes({
    type: 'text',
    id: 'pwdtext',
    name: '',
    class: 'u-pwdtext',
    placeholder: '密码',
  });
  const loginInputs = netEaseMirror
    ? [username, passwordMirror, password]
    : [username, password];
  const submitControl = {
    textContent: submitLabel,
    getAttribute(name) {
      return name === 'value' ? submitLabel : '';
    },
  };
  const form = {
    getAttribute(name) {
      if (name === 'id') return formId;
      if (name === 'action') return formAction;
      return '';
    },
    querySelectorAll(selector) {
      return selector === 'input'
        ? loginInputs
        : submitLabel
        ? [submitControl]
        : [];
    },
  };
  loginInputs.forEach((input) => {
    input.form = form;
  });
  const registrationUsername = attributes({
    type: 'text',
    id: 'register-username',
    name: 'register-username',
    placeholder: '用户名',
  });
  const registrationPasswords = [
    attributes({
      type: 'password',
      id: 'register-password',
      name: 'register-password',
      placeholder: '密码',
    }),
    attributes({
      type: 'password',
      id: 'register-confirm-password',
      name: 'register-confirm-password',
      placeholder: '确认密码',
    }),
  ];
  const registrationInputs = [registrationUsername, ...registrationPasswords];
  const registrationForm = {
    getAttribute(name) {
      return name === 'id' ? 'registerform' : '';
    },
    querySelectorAll() {
      return registrationInputs;
    },
  };
  registrationInputs.forEach((input) => {
    input.form = registrationForm;
  });
  const allInputs = backgroundRegistration
    ? [...registrationInputs, ...loginInputs]
    : loginInputs;
  const location = {
    hostname,
    pathname,
    origin: `https://${hostname}`,
    href: `https://${hostname}${pathname}`,
  };
  const document = {
    documentElement: {},
    activeElement: username,
    addEventListener() {},
    querySelectorAll() {
      return allInputs;
    },
  };
  const window = {
    location,
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    },
  };
  class TestEvent {
    constructor(type, options) {
      this.type = type;
      this.bubbles = !!options?.bubbles;
    }
  }
  const result = vm.runInNewContext(probeCode, {
    document,
    window,
    Event: TestEvent,
  });
  return {
    result,
    username,
    password,
    passwordMirror,
    registrationPasswords,
  };
};

const mislabeledAccountLogin = runPicker({
  hostname: 'accounts.example.com',
  pathname: '/login',
  formId: 'accountLoginForm',
});
assert.strictEqual(mislabeledAccountLogin.result.ok, true);
assert.strictEqual(mislabeledAccountLogin.result.action, 'filled');
assert.strictEqual(
  mislabeledAccountLogin.result.diagnostic.hasNewPassword,
  true,
);
assert.strictEqual(mislabeledAccountLogin.username.value, 'user@example.com');
assert.strictEqual(mislabeledAccountLogin.password.value, 'secret');

const mislabeledRegistration = runPicker({
  hostname: 'accounts.example.com',
  pathname: '/register',
  formId: 'registerForm',
});
assert.strictEqual(mislabeledRegistration.result.ok, false);
assert.strictEqual(mislabeledRegistration.result.reason, 'no-login-fields');

const loginButtonForm = runPicker({
  hostname: 'accounts.example.com',
  pathname: '/account',
  formId: 'credential-form',
  submitLabel: '登录',
});
assert.strictEqual(loginButtonForm.result.ok, true);
assert.strictEqual(loginButtonForm.result.action, 'filled');

const registerButtonForm = runPicker({
  hostname: 'accounts.example.com',
  pathname: '/account',
  formId: 'credential-form',
  submitLabel: '注册',
});
assert.strictEqual(registerButtonForm.result.ok, false);
assert.strictEqual(registerButtonForm.result.reason, 'no-login-fields');

const loginActionWithRegisterRedirect = runPicker({
  hostname: 'accounts.example.com',
  pathname: '/account',
  formId: 'credential-form',
  formAction: '/session/login?redirect=/register',
});
assert.strictEqual(loginActionWithRegisterRedirect.result.ok, true);

const registerActionWithLoginRedirect = runPicker({
  hostname: 'accounts.example.com',
  pathname: '/account',
  formId: 'credential-form',
  formAction: '/register?redirect=/login',
});
assert.strictEqual(registerActionWithLoginRedirect.result.ok, false);

const modalLoginOverRegistration = runPicker({
  hostname: '10002.baidubaidu.win',
  pathname: '/member.php',
  formId: 'loginform_Lj8j3',
  passwordAutocomplete: '',
  backgroundRegistration: true,
});
assert.strictEqual(modalLoginOverRegistration.result.ok, true);
assert.strictEqual(modalLoginOverRegistration.result.action, 'filled');
assert.strictEqual(
  modalLoginOverRegistration.result.diagnostic.scopeInputCount,
  2,
);
assert.strictEqual(
  modalLoginOverRegistration.username.value,
  'user@example.com',
);
assert.strictEqual(modalLoginOverRegistration.password.value, 'secret');
modalLoginOverRegistration.registrationPasswords.forEach((input) => {
  assert.strictEqual(input.value, '');
});

const mirroredLogin = runPicker({
  hostname: 'accounts.example.com',
  pathname: '/webapp/login',
  formId: 'login-form',
  netEaseMirror: true,
});
assert.strictEqual(mirroredLogin.result.ok, true);
assert.strictEqual(mirroredLogin.result.action, 'filled');
assert.strictEqual(mirroredLogin.result.diagnostic.hasNewPassword, true);
assert.strictEqual(mirroredLogin.result.diagnostic.passwordCandidateCount, 2);
assert.strictEqual(mirroredLogin.result.diagnostic.typedPasswordCount, 1);
assert.strictEqual(mirroredLogin.username.value, 'user@example.com');
assert.strictEqual(mirroredLogin.password.value, 'secret');
assert.strictEqual(mirroredLogin.passwordMirror.value, '');

const mirroredRegistration = runPicker({
  hostname: 'register.example.com',
  pathname: '/register',
  formId: 'register-form',
  netEaseMirror: true,
});
assert.strictEqual(mirroredRegistration.result.ok, false);
assert.strictEqual(mirroredRegistration.result.reason, 'no-login-fields');

const runCredentialCapture = (confirmationValue, passwordChange = false) => {
  const captureCode = buildAutofillPickerCode([], {
    bind: true,
    captureToken: 'registration-capture-token',
  });
  const listeners = new Map();
  const logs = [];
  const addListener = (type, listener) => {
    const handlers = listeners.get(type) || [];
    handlers.push(listener);
    listeners.set(type, handlers);
  };
  const attributes = (values) => ({
    tagName: 'INPUT',
    type: values.type || 'text',
    value: values.value || '',
    offsetWidth: 200,
    offsetHeight: 40,
    form: null,
    getAttribute(name) {
      return values[name] || '';
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  });
  const username = attributes({
    type: 'text',
    name: 'new-account',
    placeholder: '用户名',
    value: passwordChange ? 'existing-user' : 'new-user',
  });
  const currentPassword = attributes({
    type: 'password',
    name: 'current-password',
    autocomplete: 'current-password',
    placeholder: '旧密码',
    value: 'old-secret',
  });
  const password = attributes({
    type: 'password',
    name: 'new-password',
    autocomplete: passwordChange ? 'new-password' : '',
    placeholder: '密码',
    value: 'new-secret',
  });
  const confirmation = attributes({
    type: 'password',
    name: 'confirm-password',
    placeholder: '确认密码',
    value: confirmationValue,
  });
  const inputs = passwordChange
    ? [username, currentPassword, password, confirmation]
    : [username, password, confirmation];
  const submit = {
    textContent: '注册',
    getAttribute(name) {
      return name === 'type' ? 'submit' : '';
    },
  };
  const form = {
    tagName: 'FORM',
    ownerDocument: null,
    getAttribute(name) {
      if (name === 'id') return 'registration-form';
      if (name === 'action') return '/register';
      return '';
    },
    querySelectorAll(selector) {
      return selector === 'input' ? inputs : [submit];
    },
  };
  inputs.forEach((input) => {
    input.form = form;
  });
  const oldUsername = attributes({
    type: 'text',
    name: 'username',
    placeholder: '用户名',
    value: 'old-user',
  });
  const oldPassword = attributes({
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
    value: 'old-secret',
  });
  const oldLoginInputs = [oldUsername, oldPassword];
  const oldLoginForm = {
    tagName: 'FORM',
    ownerDocument: null,
    getAttribute(name) {
      if (name === 'id') return 'login-form';
      if (name === 'action') return '/login';
      return '';
    },
    querySelectorAll(selector) {
      return selector === 'input' ? oldLoginInputs : [];
    },
  };
  oldLoginInputs.forEach((input) => {
    input.form = oldLoginForm;
  });
  const document = {
    documentElement: {},
    activeElement: username,
    addEventListener: addListener,
    removeEventListener() {},
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [...oldLoginInputs, ...inputs];
    },
  };
  form.ownerDocument = document;
  oldLoginForm.ownerDocument = document;
  const window = {
    location: {
      hostname: 'accounts.example.com',
      pathname: '/register',
      origin: 'https://accounts.example.com',
      href: 'https://accounts.example.com/register',
    },
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    },
    addEventListener() {},
  };
  class TestMutationObserver {
    observe() {}
    disconnect() {}
  }
  vm.runInNewContext(captureCode, {
    console: { log: (message) => logs.push(message) },
    document,
    window,
    MutationObserver: TestMutationObserver,
    setTimeout,
  });
  (listeners.get('submit') || []).forEach((listener) =>
    listener({ target: form }),
  );
  return logs.filter((message) =>
    message.startsWith('__rainsee_password_capture__:'),
  );
};

const capturedRegistration = runCredentialCapture('new-secret');
assert.strictEqual(capturedRegistration.length, 1);
const capturedPayload = JSON.parse(
  capturedRegistration[0].split(':').slice(2).join(':'),
);
assert.strictEqual(capturedPayload.username, 'new-user');
assert.strictEqual(capturedPayload.password, 'new-secret');
assert.strictEqual(runCredentialCapture('different-secret').length, 0);

const capturedPasswordChange = runCredentialCapture('new-secret', true);
assert.strictEqual(capturedPasswordChange.length, 1);
const capturedPasswordChangePayload = JSON.parse(
  capturedPasswordChange[0].split(':').slice(2).join(':'),
);
assert.strictEqual(capturedPasswordChangePayload.username, 'existing-user');
assert.strictEqual(capturedPasswordChangePayload.password, 'new-secret');
assert.strictEqual(
  runCredentialCapture('different-secret', true).length,
  0,
);

const preloadSource = fs.readFileSync(
  'src/preloads/models/auto-complete.ts',
  'utf8',
);
assert.match(preloadSource, /isMislabeledLoginPassword/);
assert.match(preloadSource, /const scopes: HTMLInputElement\[\]\[\]/);
assert.match(preloadSource, /hasSemanticKeyword/);
assert.match(preloadSource, /locateFields\(\s*form/);
assert.doesNotMatch(preloadSource, /sso\.zxxk\.com|163\\\.com/);
assert.doesNotMatch(source, /sso\.zxxk\.com|163\\\.com/);

console.log('autofill picker generation tests passed');

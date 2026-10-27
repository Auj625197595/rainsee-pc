import { IFormFillData } from '~/interfaces';

interface PickerCredential {
  id: string;
  username: string;
  password: string;
  host: string;
}

interface AutofillPickerOptions {
  bind?: boolean;
  showImmediately?: boolean;
  fillSingleImmediately?: boolean;
  captureToken?: string;
}

// Cross-origin iframes do not load view-preload. This script only uses DOM APIs
// and lets the login frame present saved credentials when its fields are focused.
export const buildAutofillPickerCode = (
  items: IFormFillData[],
  options: AutofillPickerOptions = {},
): string => {
  const credentials: PickerCredential[] = items
    .map((item) => ({
      id: item._id || '',
      username: item.fields?.username || '',
      password: item.fields?.password || '',
      host: item.url || '',
    }))
    .filter((item) => !!item.password || !!item.username);
  const pickerOptions = {
    bind: options.bind !== false,
    showImmediately: !!options.showImmediately,
    fillSingleImmediately: !!options.fillSingleImmediately,
    captureToken: options.captureToken || '',
  };

  return `(function(credentials, options) {
    var pickerId = '__rainsee_frame_password_picker';
    var bindingKey = '__rainseePasswordPickerOpen';
    var observerKey = '__rainseePasswordPickerObserver';
    var interactionKey = '__rainseePasswordPickerInteraction';
    var dismissKey = '__rainseePasswordPickerDismissBound';
    var captureKey = '__rainseePasswordCaptureBound';
    var capturePendingKey = '__rainseePasswordCapturePending';
    var passwordKeywords = ['passwd', 'password', 'pwd', '\u5bc6\u7801'];
    var loginKeywords = ['username', 'user', 'account', 'login', 'usr', 'nick', 'email', 'phone', 'mobile', 'tel', 'name', 'sign', '\u7528\u6237\u540d', '\u8d26\u53f7', '\u5e10\u53f7', '\u90ae\u7bb1', '\u624b\u673a'];
    var excludedUsernameKeywords = ['captcha', 'verifycode', 'checkcode', 'vcode', 'otp', 'one-time', 'search', 'query', '\u9a8c\u8bc1\u7801', '\u641c\u7d22'];
    var unrelatedUsernameKeywords = ['newsletter', 'subscribe', 'subscription', 'invite', 'contact'];
    var filledSignatures = new WeakMap();
    var userEditedSignatures = new WeakMap();
    var lastBoundUsername = null;
    var lastBoundPassword = null;
    var lastBoundSignature = '';
    var bindTimer = null;
    var describeInput = function(el) {
      if (!el) return null;
      return {
        type: (el.getAttribute('type') || el.type || 'text').toLowerCase(),
        name: el.getAttribute('name') || '',
        id: el.getAttribute('id') || '',
        className: el.getAttribute('class') || '',
        dataLoginName: el.getAttribute('data-loginname') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        formId: el.form ? el.form.getAttribute('id') || '' : '',
        visible: isVisible(el)
      };
    };
    var hide = function() {
      var existing = document.getElementById(pickerId);
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    };
    var isVisible = function(el) {
      if (!el || el.type === 'hidden') return false;
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
      var style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };
    var tokens = function(el) {
      return (el.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/).filter(Boolean);
    };
    var semanticValues = function(el) {
      return [
        el.getAttribute('name') || '', el.getAttribute('id') || '',
        el.getAttribute('placeholder') || '', el.getAttribute('aria-label') || '',
        el.getAttribute('autocomplete') || '', el.getAttribute('class') || ''
      ].map(function(value) { return value.toLowerCase(); });
    };
    var containsKeyword = function(values, keywords) {
      for (var i = 0; i < values.length; i++) {
        for (var j = 0; j < keywords.length; j++) {
          if (values[i].indexOf(keywords[j]) >= 0) return true;
        }
      }
      return false;
    };
    var isPassword = function(el) {
      var type = (el.getAttribute('type') || el.type || 'text').toLowerCase();
      var autocomplete = tokens(el);
      return type === 'password' || autocomplete.indexOf('current-password') >= 0 ||
        autocomplete.indexOf('new-password') >= 0 ||
        containsKeyword(semanticValues(el).slice(0, 5), passwordKeywords);
    };
    var isTypedPassword = function(el) {
      return (el.getAttribute('type') || el.type || 'text').toLowerCase() === 'password';
    };
    var isConfirmation = function(el) {
      return containsKeyword(semanticValues(el), ['confirm', 'confirmation', 'repeat', 'retype', '\u786e\u8ba4', '\u91cd\u590d', '\u518d\u6b21']);
    };
    var isMislabeledLoginPassword = function(el) {
      var loginKeywords = ['login', 'log-in', 'log_in', 'signin', 'sign-in', 'sign_in',
        'logon', 'session', 'current-password', 'currentpassword', '\u767b\u5f55', '\u767b\u5165'];
      var nonLoginKeywords = ['register', 'registration', 'signup', 'sign-up', 'sign_up',
        'reset', 'forgot', 'recover', 'change-password', 'changepassword',
        '\u6ce8\u518c', '\u91cd\u7f6e', '\u627e\u56de', '\u4fee\u6539\u5bc6\u7801'];
      var form = el.form;
      var fieldValues = semanticValues(el).concat([
        (el.getAttribute('data-loginname') || '').toLowerCase()
      ]);
      var formValues = form ? [
        form.getAttribute('id') || '', form.getAttribute('name') || '',
        form.getAttribute('class') || '', form.getAttribute('aria-label') || '',
        (form.getAttribute('action') || '').split(/[?#]/)[0]
      ].map(function(value) { return value.toLowerCase(); }) : [];
      var controls = form
        ? Array.prototype.slice.call(form.querySelectorAll('button:not([type]),button[type="submit"],button[type="button"],input[type="submit"],input[type="image"]'))
        : [];
      var controlValues = controls.reduce(function(values, control) {
        return values.concat([
          control.textContent || '', control.getAttribute('value') || '',
          control.getAttribute('id') || '', control.getAttribute('name') || '',
          control.getAttribute('class') || '', control.getAttribute('aria-label') || ''
        ].map(function(value) { return value.toLowerCase(); }));
      }, []);
      var formHasLogin = containsKeyword(formValues, loginKeywords);
      var formHasNonLogin = containsKeyword(formValues, nonLoginKeywords);
      var controlHasLogin = containsKeyword(controlValues, loginKeywords);
      var controlHasNonLogin = containsKeyword(controlValues, nonLoginKeywords);
      if ((controlHasNonLogin && !controlHasLogin) ||
          (formHasNonLogin && !controlHasLogin)) return false;
      var routePaths = [
        window.location.pathname || '',
        (window.location.hash || '').replace(/^#!?/, '').split('?')[0]
      ].map(function(value) { return value.toLowerCase(); });
      var loginPath = routePaths.some(function(value) {
        return /(^|[\\/_.-])(login|signin|sign-in|logon)([\\/_.-]|$)/.test(value);
      });
      return containsKeyword(fieldValues, loginKeywords) ||
        formHasLogin || controlHasLogin || loginPath;
    };
    var isUsername = function(el) {
      var type = (el.getAttribute('type') || el.type || 'text').toLowerCase();
      if (['text', 'email', 'tel'].indexOf(type) < 0) return false;
      var values = semanticValues(el);
      var name = (el.getAttribute('name') || '').toLowerCase();
      if (name === 'code' || containsKeyword(values, excludedUsernameKeywords) ||
          containsKeyword(values, unrelatedUsernameKeywords)) return false;
      var autocomplete = tokens(el);
      if (autocomplete.indexOf('username') >= 0 || autocomplete.indexOf('email') >= 0 || autocomplete.indexOf('tel') >= 0) return true;
      return type === 'email' || type === 'tel' || containsKeyword(values, loginKeywords);
    };
    var fieldSignature = function(el) {
      if (!el) return '';
      var type = (el.getAttribute('type') || el.type || 'text').toLowerCase();
      return [
        isPassword(el) ? 'password' : type, el.getAttribute('name') || '',
        el.getAttribute('id') || '', el.getAttribute('placeholder') || '',
        el.getAttribute('autocomplete') || ''
      ].join('\\n').toLowerCase();
    };
    var rememberSignature = function(store, el) {
      var signatures = store.get(el) || new Set();
      signatures.add(fieldSignature(el));
      store.set(el, signatures);
    };
    var setValue = function(el, value) {
      try {
        var proto = Object.getPrototypeOf(el);
        var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(el, value);
        else el.value = value;
      } catch (error) {
        el.value = value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    var collectInputScopes = function(inputs, preferredForm) {
      var scopes = [];
      var seenForms = [];
      var addForm = function(form) {
        if (!form || seenForms.indexOf(form) >= 0) return;
        var formInputs = Array.prototype.slice.call(form.querySelectorAll('input')).filter(isVisible);
        if (!formInputs.some(isPassword)) return;
        seenForms.push(form);
        scopes.push(formInputs);
      };
      if (preferredForm) {
        addForm(preferredForm);
        return scopes;
      }
      var active = document.activeElement;
      if (active && active.tagName === 'INPUT') addForm(active.form);
      inputs.forEach(function(input) {
        if (isPassword(input)) addForm(input.form);
      });
      var unowned = inputs.filter(function(input) { return !input.form; });
      if (unowned.some(isPassword)) scopes.push(unowned);
      if (!scopes.length) scopes.push(inputs);
      return scopes;
    };
    var inspectFields = function(inputs, allInputs, scopeCount) {
      var passwords = inputs.filter(isPassword);
      // Some password widgets keep a visible type=text mirror for their reveal
      // control. Its password-like metadata can create a second semantic candidate
      // even though the form contains only one real password input.
      var typedPasswords = passwords.filter(isTypedPassword);
      var newPassword = passwords.filter(function(input) { return tokens(input).indexOf('new-password') >= 0; })[0] || null;
      var confirmationPassword = passwords.filter(isConfirmation)[0] || null;
      var confirmation = !!confirmationPassword;
      var currentPasswords = passwords.filter(function(input) { return tokens(input).indexOf('current-password') >= 0; });
      var password = currentPasswords[0] || null;
      var passwordCandidate = typedPasswords.length === 1
        ? typedPasswords[0]
        : (typedPasswords.length === 0 && passwords.length === 1 ? passwords[0] : null);
      var candidateIsNewPassword = passwordCandidate &&
        tokens(passwordCandidate).indexOf('new-password') >= 0;
      var isLoginForm = !confirmation && !!(
        password ||
        (passwordCandidate && (!candidateIsNewPassword || isMislabeledLoginPassword(passwordCandidate)))
      );
      if (!password && passwordCandidate) {
        password = passwordCandidate;
      }
      var confirmationIndex = confirmationPassword ? passwords.indexOf(confirmationPassword) : -1;
      var passwordBeforeConfirmation = confirmationIndex > 0 ? passwords[confirmationIndex - 1] : null;
      var savePassword = newPassword || passwordBeforeConfirmation || passwords[passwords.length - 1] || null;
      var diagnostic = {
        document: window.location.origin + window.location.pathname,
        inputCount: allInputs.length,
        visibleInputCount: allInputs.filter(isVisible).length,
        scopeInputCount: inputs.length,
        scopeCount: scopeCount,
        passwordCandidateCount: passwords.length,
        typedPasswordCount: typedPasswords.length,
        passwordCandidates: passwords.map(describeInput),
        hasNewPassword: !!newPassword,
        hasConfirmation: confirmation
      };
      var fieldPassword = password || savePassword;
      if (!fieldPassword) return {
        username: null, password: null, savePassword: null,
        confirmationPassword: confirmationPassword, isLoginForm: false, diagnostic: diagnostic
      };

      var passwordInputIndex = inputs.indexOf(fieldPassword);
      var candidates = fieldPassword.form
        ? Array.prototype.slice.call(fieldPassword.form.querySelectorAll('input')).filter(isVisible)
        : inputs.slice(Math.max(0, passwordInputIndex - 4), passwordInputIndex + 5);
      var passwordIndex = candidates.indexOf(fieldPassword);
      var username = null;
      for (var i = passwordIndex - 1; i >= 0; i--) {
        if (isUsername(candidates[i])) { username = candidates[i]; break; }
      }
      if (!username) {
        for (var j = passwordIndex + 1; j < candidates.length; j++) {
          if (isUsername(candidates[j])) { username = candidates[j]; break; }
        }
      }
      diagnostic.username = describeInput(username);
      diagnostic.password = describeInput(password);
      diagnostic.savePassword = describeInput(savePassword);
      return {
        username: username, password: password, savePassword: savePassword,
        confirmationPassword: confirmationPassword,
        isLoginForm: isLoginForm, diagnostic: diagnostic
      };
    };
    var findFields = function(preferredForm) {
      var allInputs = Array.prototype.slice.call(document.querySelectorAll('input'));
      var inputs = allInputs.filter(isVisible);
      var scopes = collectInputScopes(inputs, preferredForm);
      var fallback = null;
      for (var i = 0; i < scopes.length; i++) {
        var fields = inspectFields(scopes[i], allInputs, scopes.length);
        if (fields.isLoginForm) return fields;
        if (!fallback && (fields.password || fields.savePassword)) fallback = fields;
      }
      return fallback || inspectFields(preferredForm ? [] : inputs, allInputs, scopes.length);
    };
    var fill = function(fields, credential) {
      if (!fields.isLoginForm) return;
      if (fields.username && credential.username) setValue(fields.username, credential.username);
      if (fields.password && credential.password) setValue(fields.password, credential.password);
    };
    var show = function(anchor) {
      hide();
      if (!credentials.length || !anchor) return false;
      var fields = findFields();
      if (!fields.isLoginForm ||
          (anchor !== fields.username && anchor !== fields.password)) return false;
      var menu = document.createElement('div');
      menu.id = pickerId;
      var rect = anchor.getBoundingClientRect();
      Object.assign(menu.style, {
        position: 'fixed', left: Math.max(8, rect.left) + 'px', top: (rect.bottom + 6) + 'px',
        minWidth: Math.max(240, rect.width) + 'px', maxWidth: '360px', maxHeight: '280px',
        overflowY: 'auto', boxSizing: 'border-box', padding: '6px', background: '#fff',
        border: '1px solid #d9e2f2', borderRadius: '8px', boxShadow: '0 8px 24px rgba(30, 64, 175, .2)',
        zIndex: '2147483647', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '13px', color: '#172033'
      });
      credentials.forEach(function(credential) {
        var option = document.createElement('button');
        option.type = 'button';
        option.textContent = (credential.username || '(\u65e0\u7528\u6237\u540d)') + '  ' + credential.host;
        Object.assign(option.style, {
          display: 'block', width: '100%', border: '0', borderRadius: '5px', padding: '9px 10px',
          background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        });
        option.addEventListener('mouseenter', function() { option.style.background = '#edf4ff'; });
        option.addEventListener('mouseleave', function() { option.style.background = 'transparent'; });
        option.addEventListener('mousedown', function(event) {
          event.preventDefault();
          fill(findFields(), credential);
          hide();
        });
        menu.appendChild(option);
      });
      document.body.appendChild(menu);
      return true;
    };
    var unbind = function(input) {
      if (!input) return;
      var previous = input[bindingKey];
      if (!previous) return;
      input.removeEventListener('focus', previous);
      input.removeEventListener('click', previous);
      delete input[bindingKey];
    };
    var bind = function() {
      var fields = findFields();
      if (!fields.isLoginForm) {
        unbind(lastBoundUsername);
        unbind(lastBoundPassword);
        lastBoundUsername = null;
        lastBoundPassword = null;
        lastBoundSignature = '';
        hide();
        return;
      }
      var bindingSignature = fieldSignature(fields.username) + '\\n' + fieldSignature(fields.password);
      var fieldsChanged = fields.username !== lastBoundUsername ||
        fields.password !== lastBoundPassword || bindingSignature !== lastBoundSignature;
      // 跨域登录帧没有 view-preload,因此在字段首次出现或登录方式切换后,
      // 单条凭据也要像主页面自动填充引擎一样立即填入。
      if (options.fillSingleImmediately && credentials.length === 1) {
        var credential = credentials[0];
        [
          [fields.username, credential.username],
          [fields.password, credential.password]
        ].forEach(function(pair) {
          var input = pair[0];
          var value = pair[1];
          if (!input || !value || input.value) return;
          var signature = fieldSignature(input);
          var filled = filledSignatures.get(input);
          var edited = userEditedSignatures.get(input);
          if ((filled && filled.has(signature)) ||
              (edited && edited.has(signature))) return;
          setValue(input, value);
          rememberSignature(filledSignatures, input);
        });
      }
      if (!fieldsChanged) return;
      [fields.username, fields.password].forEach(function(input) {
        if (!input) return;
        var previous = input[bindingKey];
        if (previous) {
          input.removeEventListener('focus', previous);
          input.removeEventListener('click', previous);
        }
        var open = function() { show(input); };
        input[bindingKey] = open;
        input.addEventListener('focus', open);
        input.addEventListener('click', open);
      });
      lastBoundUsername = fields.username;
      lastBoundPassword = fields.password;
      lastBoundSignature = bindingSignature;
    };
    var scheduleBind = function(delay) {
      if (bindTimer) {
        if (delay !== 0) return;
        clearTimeout(bindTimer);
      }
      bindTimer = setTimeout(function() {
        bindTimer = null;
        bind();
      }, delay == null ? 200 : delay);
    };

    if (options.bind) {
      bind();
      var previousObserver = document.documentElement[observerKey];
      if (previousObserver) previousObserver.disconnect();
      var observer = new MutationObserver(function(mutations) {
        var hasPageMutation = mutations.some(function(mutation) {
          var target = mutation.target;
          return !target.closest || !target.closest('#' + pickerId);
        });
        if (hasPageMutation) scheduleBind(200);
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'type',
          'name',
          'autocomplete',
          'class',
          'style',
          'hidden',
          'aria-hidden',
          'disabled',
        ],
      });
      document.documentElement[observerKey] = observer;
      var previousInteraction = document.documentElement[interactionKey];
      if (previousInteraction) {
        document.removeEventListener('focusin', previousInteraction.focusin, true);
        document.removeEventListener('input', previousInteraction.input, true);
      }
      var focusinHandler = function(event) {
        if (event.target && event.target.tagName === 'INPUT') scheduleBind(0);
      };
      var inputHandler = function(event) {
        if (event.isTrusted && event.target && event.target.tagName === 'INPUT') {
          rememberSignature(userEditedSignatures, event.target);
        }
      };
      document.addEventListener('focusin', focusinHandler, true);
      document.addEventListener('input', inputHandler, true);
      document.documentElement[interactionKey] = {
        focusin: focusinHandler,
        input: inputHandler,
      };

      if (options.captureToken && !document.documentElement[captureKey]) {
        var captureCredential = function(form) {
          var current = findFields(form || null);
          var password = current.savePassword || current.password;
          if (!password || !password.value) return null;
          if (current.confirmationPassword && current.confirmationPassword.value !== password.value) return null;
          var captured = {
            username: current.username ? current.username.value : '',
            password: password.value,
            url: window.location.href
          };
          document.documentElement[capturePendingKey] = captured;
          return captured;
        };
        var reportCredential = function(form) {
          var captured = captureCredential(form || null) || document.documentElement[capturePendingKey];
          if (!captured || !captured.password) return;
          document.documentElement[capturePendingKey] = null;
          try {
            console.log('__rainsee_password_capture__:' + options.captureToken + ':' + JSON.stringify(captured));
          } catch (error) {}
        };

        var isLikelySubmitControl = function(target) {
          if (!target || !target.closest) return false;
          var control = target.closest('button,input[type="submit"],input[type="image"],[role="button"],a,[data-action]');
          if (!control) return false;
          var semantic = [
            control.textContent || '', control.getAttribute('aria-label') || '',
            control.getAttribute('name') || '', control.getAttribute('id') || '',
            control.getAttribute('class') || '', control.getAttribute('data-action') || ''
          ].join(' ').toLowerCase();
          return ['login', 'log in', 'sign in', 'register', 'sign up', 'signup',
            'create account', 'submit', 'continue', 'next', 'dologin',
            '\u767b\u5f55', '\u767b\u5165', '\u6ce8\u518c', '\u521b\u5efa\u8d26\u53f7',
            '\u63d0\u4ea4', '\u7ee7\u7eed', '\u4e0b\u4e00\u6b65', '\u786e\u5b9a'
          ].some(function(keyword) { return semantic.indexOf(keyword) >= 0; });
        };

        document.addEventListener('submit', function(event) {
          var form = event.target && event.target.tagName === 'FORM' ? event.target : null;
          captureCredential(form);
          reportCredential(form);
        }, true);
        document.addEventListener('click', function(event) {
          if (!isLikelySubmitControl(event.target)) return;
          var form = event.target && event.target.closest ? event.target.closest('form') : null;
          if (!captureCredential(form)) return;
          // pagehide will report first on a successful navigation. The delayed
          // fallback also covers XHR/postMessage login flows without navigation.
          setTimeout(function() { reportCredential(form); }, 400);
        }, true);
        document.addEventListener('keydown', function(event) {
          var form = event.target && event.target.form ? event.target.form : null;
          if (event.key !== 'Enter' || !captureCredential(form)) return;
          setTimeout(function() { reportCredential(form); }, 400);
        }, true);
        document.addEventListener('input', function() {
          document.documentElement[capturePendingKey] = null;
        }, true);
        window.addEventListener('pagehide', function() { reportCredential(); });
        window.addEventListener('beforeunload', function() { reportCredential(); });
        document.documentElement[captureKey] = true;
      }
    }
    if ((options.bind || options.showImmediately) && !document.documentElement[dismissKey]) {
      document.documentElement[dismissKey] = true;
      document.addEventListener('mousedown', function(event) {
        var menu = document.getElementById(pickerId);
        if (menu && !menu.contains(event.target)) hide();
      });
    }

    var fields = findFields();
    if (!fields.password || !fields.isLoginForm) return { ok: false, reason: 'no-login-fields', diagnostic: fields.diagnostic };
    if (options.showImmediately) {
      if (credentials.length === 1 && options.fillSingleImmediately) {
        fill(fields, credentials[0]);
        return { ok: true, action: 'filled', credentialId: credentials[0].id, diagnostic: fields.diagnostic };
      }
      var active = document.activeElement;
      var anchor = active === fields.username || active === fields.password
        ? active : (fields.username || fields.password);
      return { ok: show(anchor), action: 'picker', count: credentials.length, diagnostic: fields.diagnostic };
    }
    return { ok: true, action: 'bound', diagnostic: fields.diagnostic };
  })(${JSON.stringify(credentials)}, ${JSON.stringify(pickerOptions)});`;
};

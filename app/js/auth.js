// ===================================================== sign-in screens
const authCard = (title, sub, body, foot = "") => `<div class="auth-wrap"><div class="card auth-card"><div class="card-pad stack-lg">
  <a href="../">${logo()}</a>
  <div><h1 style="font-size:24px">${title}</h1>${sub ? `<p class="muted" style="margin-top:6px">${sub}</p>` : ""}</div>
  ${body}${foot ? `<div class="small muted">${foot}</div>` : ""}
</div></div></div>`;

function pageSignIn() {
  return authCard("Sign in to BuildOS", "", form("signIn", `<div class="stack">
    <label class="field"><span>Email</span><input name="email" type="email" class="input" autocomplete="email" autofocus></label>
    <label class="field"><span>Password</span><input name="password" type="password" class="input" autocomplete="current-password"></label>
    <button class="btn btn-primary btn-lg">Sign in</button></div>`),
  `<a class="link" href="#/forgot">Forgot your password?</a><br>New to BuildOS? <a class="link" href="#/signup">Create an account</a>`);
}

function pageSignUp() {
  return authCard("Create your account", "If your company already uses BuildOS, sign up with the email your admin invited — you'll join automatically.", form("signUp", `<div class="stack">
    <label class="field"><span>Full name</span><input name="full_name" class="input" autocomplete="name"></label>
    <label class="field"><span>Work email</span><input name="email" type="email" class="input" autocomplete="email"></label>
    <label class="field"><span>Password <span class="muted">(at least 8 characters)</span></span><input name="password" type="password" class="input" autocomplete="new-password" minlength="8"></label>
    <button class="btn btn-primary btn-lg">Create account</button></div>`),
  `Already have an account? <a class="link" href="#/login">Sign in</a>`);
}

function pageForgot() {
  return authCard("Reset your password", "We'll email you a link to choose a new password.", form("forgot", `<div class="stack">
    <label class="field"><span>Email</span><input name="email" type="email" class="input" autocomplete="email"></label>
    <button class="btn btn-primary btn-lg">Send reset link</button></div>`),
  `<a class="link" href="#/login">Back to sign in</a>`);
}

function pageReset() {
  if (!SESSION) return authCard("Link expired", "That reset link is no longer valid. Request a new one.", `<a class="btn btn-primary" href="#/forgot">Send a new link</a>`);
  return authCard("Choose a new password", "", form("resetPassword", `<div class="stack">
    <label class="field"><span>New password</span><input name="password" type="password" class="input" autocomplete="new-password" minlength="8"></label>
    <label class="field"><span>Confirm new password</span><input name="confirm" type="password" class="input" autocomplete="new-password"></label>
    <button class="btn btn-primary btn-lg">Save password</button></div>`));
}

function pageCheckEmail(q) {
  return authCard("Check your email", `We've sent a confirmation link to <b>${esc(q.email || "your inbox")}</b>. Open it on this device to finish signing up.`, `<a class="btn" href="#/login">Back to sign in</a>`,
    "Nothing arrived? Check your spam folder, or wait a minute and try signing up again.");
}

function pageWelcome() {
  return authCard("Set up your company", `Signed in as <b>${esc(SESSION.user.email)}</b>.`, `
    ${form("createOrg", `<div class="stack">
      <label class="field"><span>Company name</span><input name="name" class="input" autocomplete="organization" placeholder="e.g. Stratton Construction"></label>
      <label class="field"><span>ABN <span class="muted">(optional)</span></span><input name="abn" class="input"></label>
      <button class="btn btn-primary btn-lg">Create company</button></div>`)}
    <div class="notice notice-info">${icon("users")}<span>Joining an existing company instead? Ask its admin to invite <b>${esc(SESSION.user.email)}</b>, then <a class="link" href="#/" data-refresh>refresh</a>.</span></div>`,
  `<button class="btn btn-ghost" type="button" data-signout style="padding:0">Sign out</button>`);
}

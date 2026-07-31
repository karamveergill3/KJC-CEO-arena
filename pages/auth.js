import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useRouter } from 'next/router';
import Head from 'next/head';

const gold = '#e8a020';
const goldDim = 'rgba(232,160,32,0.15)';

const input = {
  width: '100%',
  padding: '13px 16px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  color: '#fff',
  fontSize: 15,
  fontFamily: 'inherit',
  outline: 'none',
  marginBottom: 14,
  boxSizing: 'border-box',
};

const btn = {
  width: '100%',
  padding: '14px',
  background: `linear-gradient(135deg, #e8a020, #c07010)`,
  border: 'none',
  borderRadius: 10,
  color: '#000',
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: 2,
  cursor: 'pointer',
  fontFamily: 'inherit',
  marginTop: 4,
};

const btnSecondary = {
  ...btn,
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.15)',
  color: '#ccc',
  marginTop: 10,
};

const err = {
  fontSize: 13,
  color: '#f07070',
  marginBottom: 12,
  padding: '10px 14px',
  background: 'rgba(220,50,50,0.08)',
  borderRadius: 8,
  border: '1px solid rgba(220,50,50,0.2)',
};

const success = {
  fontSize: 13,
  color: '#3ee89a',
  marginBottom: 12,
  padding: '10px 14px',
  background: 'rgba(62,232,154,0.08)',
  borderRadius: 8,
  border: '1px solid rgba(62,232,154,0.2)',
};

export default function Auth() {
  const router = useRouter();
  // Screens: 'login' | 'signup' | 'verify' | 'username'
  const [screen, setScreen] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Signup fields
  const [signupData, setSignupData] = useState({ firstName: '', lastName: '', email: '', dob: '', password: '', confirmPassword: '' });
  // Verify
  const [verifyCode, setVerifyCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  // Username
  const [username, setUsername] = useState('');
  // Login
  const [loginData, setLoginData] = useState({ username: '', password: '' });

  const handleSignup = async (e) => {
    e.preventDefault();
    setError(''); setMsg('');
    const { firstName, lastName, email, dob, password, confirmPassword } = signupData;
    if (!firstName || !lastName || !email || !dob || !password) return setError('Please fill in all fields.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    // Validate age (must be 13+)
    const age = (new Date() - new Date(dob)) / (1000 * 60 * 60 * 24 * 365.25);
    if (age < 13) return setError('You must be at least 13 years old.');

    setLoading(true);
    const { data, error: signupErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: null,
        data: { first_name: firstName, last_name: lastName, dob },
      },
    });
    setLoading(false);

    if (signupErr) return setError(signupErr.message);
    setPendingEmail(email);
    setScreen('verify');
    setMsg(`A 6-digit code has been sent to ${email}`);
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError(''); setMsg('');
    if (verifyCode.length !== 8) return setError('Please enter the 8-digit code.');
    setLoading(true);
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email: pendingEmail,
      token: verifyCode,
      type: 'signup',
    });
    setLoading(false);
    if (verifyErr) return setError('Invalid or expired code. Please try again.');
    setScreen('username');
    setMsg('Email verified! Now choose your username.');
  };

  const handleUsername = async (e) => {
    e.preventDefault();
    setError(''); setMsg('');
    if (!username || username.length < 3) return setError('Username must be at least 3 characters.');
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return setError('Username can only contain letters, numbers and underscores.');
    setLoading(true);

    // Check uniqueness
    const { data: existing } = await supabase
      .from('profiles')
      .select('username')
      .eq('username', username.toLowerCase())
      .single();

    if (existing) {
      setLoading(false);
      return setError('That username is already taken.');
    }

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return setError('Session expired. Please sign up again.'); }

    // Save profile (including email for username login)
    const { error: profileErr } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        username: username.toLowerCase(),
        first_name: user.user_metadata.first_name,
        last_name: user.user_metadata.last_name,
        dob: user.user_metadata.dob,
        email: user.email,
        created_at: new Date().toISOString(),
      });

    setLoading(false);
    if (profileErr) return setError(profileErr.message);
    router.push('/');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setMsg('');
    if (!loginData.username || !loginData.password) return setError('Please enter your username and password.');
    setLoading(true);

    // Look up email directly from profiles table
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('username', loginData.username.toLowerCase())
      .single();

    if (profileErr || !profile) {
      setLoading(false);
      return setError('Username not found.');
    }

    if (!profile.email) {
      setLoading(false);
      return setError('Account setup incomplete. Please sign up again.');
    }

    const { error: loginErr } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: loginData.password,
    });

    setLoading(false);
    if (loginErr) return setError('Incorrect password.');
    router.push('/');
  };

  const wrap = {
    minHeight: '100vh',
    background: '#0a0a0f',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 16px',
    fontFamily: "'Inter', system-ui, sans-serif",
  };

  const card = {
    width: '100%',
    maxWidth: 420,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: '36px 32px',
  };

  return (
    <>
      <Head>
        <title>Code Review Arena</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </Head>
      <div style={wrap}>
        <div style={card}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.85)', letterSpacing: 3 }}>CODE REVIEW ARENA</div>
          </div>

          {error && <div style={err}>{error}</div>}
          {msg && <div style={success}>{msg}</div>}

          {/* LOGIN */}
          {screen === 'login' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 20 }}>Welcome back</h2>
              <form onSubmit={handleLogin}>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, display: 'block', marginBottom: 6 }}>USERNAME</label>
                <input style={input} placeholder="your_username" value={loginData.username}
                  onChange={e => setLoginData(p => ({ ...p, username: e.target.value }))} autoComplete="username" />
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, display: 'block', marginBottom: 6 }}>PASSWORD</label>
                <input style={input} type="password" placeholder="••••••••" value={loginData.password}
                  onChange={e => setLoginData(p => ({ ...p, password: e.target.value }))} autoComplete="current-password" />
                <button type="submit" style={btn} disabled={loading}>{loading ? 'SIGNING IN...' : 'SIGN IN'}</button>
              </form>
              <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                Don't have an account?{' '}
                <span onClick={() => { setScreen('signup'); setError(''); setMsg(''); }}
                  style={{ color: gold, cursor: 'pointer', fontWeight: 600 }}>Sign up</span>
              </div>
            </>
          )}

          {/* SIGNUP */}
          {screen === 'signup' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 20 }}>Create account</h2>
              <form onSubmit={handleSignup}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, display: 'block', marginBottom: 6 }}>FIRST NAME</label>
                    <input style={input} placeholder="John" value={signupData.firstName}
                      onChange={e => setSignupData(p => ({ ...p, firstName: e.target.value }))} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, display: 'block', marginBottom: 6 }}>LAST NAME</label>
                    <input style={input} placeholder="Smith" value={signupData.lastName}
                      onChange={e => setSignupData(p => ({ ...p, lastName: e.target.value }))} />
                  </div>
                </div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, display: 'block', marginBottom: 6 }}>EMAIL</label>
                <input style={input} type="email" placeholder="john@example.com" value={signupData.email}
                  onChange={e => setSignupData(p => ({ ...p, email: e.target.value }))} autoComplete="email" />
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, display: 'block', marginBottom: 6 }}>DATE OF BIRTH</label>
                <input style={input} type="date" value={signupData.dob}
                  onChange={e => setSignupData(p => ({ ...p, dob: e.target.value }))} />
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, display: 'block', marginBottom: 6 }}>PASSWORD</label>
                <input style={input} type="password" placeholder="At least 8 characters" value={signupData.password}
                  onChange={e => setSignupData(p => ({ ...p, password: e.target.value }))} autoComplete="new-password" />
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, display: 'block', marginBottom: 6 }}>CONFIRM PASSWORD</label>
                <input style={input} type="password" placeholder="Repeat password" value={signupData.confirmPassword}
                  onChange={e => setSignupData(p => ({ ...p, confirmPassword: e.target.value }))} />
                <button type="submit" style={btn} disabled={loading}>{loading ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}</button>
              </form>
              <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                Already have an account?{' '}
                <span onClick={() => { setScreen('login'); setError(''); setMsg(''); }}
                  style={{ color: gold, cursor: 'pointer', fontWeight: 600 }}>Sign in</span>
              </div>
            </>
          )}

          {/* VERIFY EMAIL */}
          {screen === 'verify' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Check your email</h2>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 24, lineHeight: 1.6 }}>
                We sent an 8-digit code to <strong style={{ color: '#fff' }}>{pendingEmail}</strong>. Enter the 8-digit code below to verify your account.
              </p>
              <form onSubmit={handleVerify}>
                <input style={{ ...input, fontSize: 28, letterSpacing: 12, textAlign: 'center', fontFamily: 'monospace' }}
                  placeholder="00000000" maxLength={8} value={verifyCode}
                  onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 8))} />
                <button type="submit" style={btn} disabled={loading || verifyCode.length !== 8}>
                  {loading ? 'VERIFYING...' : 'VERIFY EMAIL'}
                </button>
                <button type="button" style={btnSecondary} onClick={async () => {
                  await supabase.auth.resend({ type: 'signup', email: pendingEmail });
                  setMsg('New code sent!');
                }}>Resend code</button>
              </form>
            </>
          )}

          {/* SET USERNAME */}
          {screen === 'username' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Choose a username</h2>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 24, lineHeight: 1.6 }}>
                This is how you'll sign in. Letters, numbers and underscores only.
              </p>
              <form onSubmit={handleUsername}>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, display: 'block', marginBottom: 6 }}>USERNAME</label>
                <input style={input} placeholder="john_smith" value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
                <button type="submit" style={btn} disabled={loading || username.length < 3}>
                  {loading ? 'SAVING...' : 'CONTINUE TO ARENA →'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  );
}

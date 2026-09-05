// src/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const prisma = require('../db');

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('[login] attempt with email:', JSON.stringify(email));

  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user) {
    console.log('[login] no user found for that email');
    return res.render('login', { error: 'Email ou mot de passe invalide' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  console.log('[login] password match:', ok);
  if (!ok) return res.render('login', { error: 'Email ou mot de passe invalide' });

  req.session.userId = user.id;
  console.log('[login] success, session set for user id', user.id);
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;

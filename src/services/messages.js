// src/services/messages.js
//
// Every client-facing message is composed in French, then English, then
// Arabic, in that fixed order, per business requirement.
//
// Two versions of each message exist:
//   - `sms`   : French + English only, plain text, separated by a blank
//               line (SMS is billed per 160-char segment, and ANY Arabic/
//               unicode content forces the whole message into 70-char
//               UCS-2 segments - see README "SMS cost note" - so Arabic is
//               left out of SMS specifically to avoid that cost multiplier)
//   - `email` : fuller text, rendered as simple HTML with all 3 languages
//               stacked and separated by a rule
//
// COMPANY_NAME / COMPANY_PHONE / COMPANY_EMAIL come from environment
// variables so they're not hard-coded in source.

const COMPANY_NAME = process.env.COMPANY_NAME || 'United Transport Solutions';
const COMPANY_PHONE = process.env.COMPANY_PHONE || '+212 700-172779';
const COMPANY_EMAIL = process.env.COMPANY_EMAIL || 'contact@unitedtransportsolutions.com';
// Base URL of this backend itself (not the marketing website), used to build
// the Accepter/Refuser links in the ready_to_work email
// (/respond/:token?action=accept|refuse - see src/routes/publicApi.js). No
// trailing slash. Falls back to the known Render URL if unset.
const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://uts-backendrepo.onrender.com').replace(/\/$/, '');

/**
 * Each template function returns { fr, en, ar } — three plain strings.
 * `data` varies per message type (see call sites in routes).
 */
const templates = {
  quote_received: (data) => ({
    fr: `Bonjour ${data.name}, nous avons bien reçu votre demande de devis. Notre équipe vous recontactera très prochainement. — ${COMPANY_NAME}`,
    en: `Hello ${data.name}, we've received your quote request. Our team will be in touch shortly. — ${COMPANY_NAME}`,
    ar: `مرحباً ${data.name}، لقد تلقينا طلب عرض السعر الخاص بكم. سيتواصل معكم فريقنا في أقرب وقت. — ${COMPANY_NAME}`
  }),

  // data.quotes is an array of { airport, company, direct, tarif } - one
  // item for a single quote, several for multiple options to choose from.
  // "direct" is the raw form value ("Direct" / "Non direct") and is only
  // ever set from that fixed select, so it's safe to print as-is in FR/EN.
  //
  // Wording changes based on quotes.length:
  //   - 1 quote  -> a single flowing sentence stating that one rate, same
  //                 shape as before this feature existed.
  //   - 2+ quotes -> an explicit "here are our options" intro, each option
  //                 numbered, so the client can clearly compare and reply
  //                 with which one they want. In the email, this additionally
  //                 renders as a real numbered list (see emailFr/En/Ar below)
  //                 instead of a run-on sentence, since email has room for it;
  //                 the SMS/plain-text version (fr, used by composeSms) stays
  //                 a single compact line per option to control per-segment
  //                 SMS cost (see README "SMS cost & deliverability").
  ready_to_work: (data) => {
    const quotes = Array.isArray(data.quotes) && data.quotes.length ? data.quotes : [{ airport: '—', company: '—', direct: '—', tarif: data.pricePerKg || '—' }];
    const n = quotes.length;
    const directAr = (d) => (d === 'Direct' ? 'مباشرة' : d === 'Non direct' ? 'مع توقف' : d);

    // --- plain-text lines (used by SMS, and by the single-quote email) ---
    const lineFr = (q, i) => `${n > 1 ? `Option ${i + 1} : ` : ''}${q.company}, vol ${q.direct === 'Direct' ? 'direct' : 'avec escale'} vers ${q.airport}, tarif ${q.tarif} DHS/kg TTC.`;
    const lineEn = (q, i) => `${n > 1 ? `Option ${i + 1}: ` : ''}${q.company}, ${q.direct === 'Direct' ? 'direct' : 'connecting'} flight to ${q.airport}, rate ${q.tarif} DHS/kg (all taxes included).`;
    const lineAr = (q, i) => `${n > 1 ? `الخيار ${i + 1}: ` : ''}${q.company}، رحلة ${directAr(q.direct)} إلى ${q.airport}، بسعر ${q.tarif} درهم/كلغ شامل جميع الضرائب.`;

    const introFr = n > 1
      ? `Bonjour ${data.name}, bonne nouvelle : suite à votre demande de devis, nous sommes prêts à traiter votre envoi. Voici nos ${n} propositions :`
      : `Bonjour ${data.name}, bonne nouvelle : suite à votre demande de devis, nous sommes prêts à traiter votre envoi :`;
    const introEn = n > 1
      ? `Hello ${data.name}, good news: following your quote request, we're ready to handle your shipment. Here are our ${n} options:`
      : `Hello ${data.name}, good news: following your quote request, we're ready to handle your shipment:`;
    const introAr = n > 1
      ? `مرحباً ${data.name}، خبر سار: بناءً على طلب عرض السعر الخاص بكم، نحن جاهزون للتكفل بشحنتكم. إليكم عروضنا:`
      : `مرحباً ${data.name}، خبر سار: بناءً على طلب عرض السعر الخاص بكم، نحن جاهزون للتكفل بشحنتكم:`;

    const closingFr = n > 1
      ? `Merci de nous indiquer l'option que vous choisissez. N'hésitez pas à nous appeler au ${COMPANY_PHONE} ou à nous écrire à ${COMPANY_EMAIL} pour toute question.`
      : `N'hésitez pas à nous appeler au ${COMPANY_PHONE} ou à nous écrire à ${COMPANY_EMAIL} si vous souhaitez ajuster ce tarif.`;
    const closingEn = n > 1
      ? `Please let us know which option you'd like to go with. Feel free to call us at ${COMPANY_PHONE} or email ${COMPANY_EMAIL} with any questions.`
      : `Feel free to call us at ${COMPANY_PHONE} or email ${COMPANY_EMAIL} if you'd like to discuss adjusting this rate.`;
    const closingAr = n > 1
      ? `يرجى إخبارنا بالخيار الذي ترغبون في اعتماده. لا تترددوا في الاتصال بنا على ${COMPANY_PHONE} أو مراسلتنا على ${COMPANY_EMAIL} لأي استفسار.`
      : `لا تترددوا في الاتصال بنا على ${COMPANY_PHONE} أو مراسلتنا على ${COMPANY_EMAIL} إذا رغبتم في مناقشة تعديل هذا السعر.`;

    // Plain text (SMS uses fr only; en/ar plain text kept for anywhere a
    // non-HTML fallback is needed).
    const fr = `${introFr} ${quotes.map(lineFr).join(' ')} ${closingFr}`;
    const en = `${introEn} ${quotes.map(lineEn).join(' ')} ${closingEn}`;
    const ar = `${introAr} ${quotes.map(lineAr).join(' ')} ${closingAr}`;

    // HTML versions for the email only: a real numbered list when there's
    // more than one option, so each one is clearly presented on its own
    // line instead of packed into one sentence. A single quote still reads
    // as one clean sentence, matching how it looked before this feature.
    const listItem = (text) => `<li style="margin-bottom:6px;">${text}</li>`;
    const rowFr = (q) => `${q.company} — vol ${q.direct === 'Direct' ? 'direct' : 'avec escale'} vers <strong>${q.airport}</strong> — <strong>${q.tarif} DHS/kg TTC</strong>`;
    const rowEn = (q) => `${q.company} — ${q.direct === 'Direct' ? 'direct' : 'connecting'} flight to <strong>${q.airport}</strong> — <strong>${q.tarif} DHS/kg</strong> (all taxes included)`;
    const rowAr = (q) => `${q.company} — رحلة ${directAr(q.direct)} إلى <strong>${q.airport}</strong> — <strong>${q.tarif} درهم/كلغ</strong> شامل جميع الضرائب`;

    // Accepter / Refuser buttons - only shown when a responseToken was
    // generated (see dashboard.js POST /clients/:id/ready-to-work). Clicking
    // either one hits the public, no-login /respond/:token route and records
    // the client's answer, visible in Demandes en Attente (see publicApi.js).
    // Left out entirely if no token is present, so older call sites (or a
    // resend that somehow lost the token) still produce a valid email.
    const buttonsHtml = data.responseToken ? (() => {
      const acceptUrl = `${APP_BASE_URL}/respond/${data.responseToken}?action=accept`;
      const refuseUrl = `${APP_BASE_URL}/respond/${data.responseToken}?action=refuse`;
      const btn = (url, label, bg) =>
        `<a href="${url}" style="display:inline-block; margin:4px 8px 4px 0; padding:10px 22px; background:${bg}; color:#ffffff; font-family:Arial,sans-serif; font-size:14px; font-weight:bold; text-decoration:none; border-radius:5px;">${label}</a>`;
      return `<div style="margin:14px 0 4px;">${btn(acceptUrl, 'Accepter / Accept / أوافق', '#2e7d32')}${btn(refuseUrl, 'Refuser / Decline / أرفض', '#B7402F')}</div>`;
    })() : '';

    const emailFr = n > 1
      ? `<p style="margin:0 0 10px;">${introFr}</p><ol style="margin:0 0 10px; padding-left:20px;">${quotes.map(q => listItem(rowFr(q))).join('')}</ol><p style="margin:0;">${closingFr}</p>${buttonsHtml}`
      : `<p style="margin:0;">${fr}</p>${buttonsHtml}`;
    const emailEn = n > 1
      ? `<p style="margin:0 0 10px;">${introEn}</p><ol style="margin:0 0 10px; padding-left:20px;">${quotes.map(q => listItem(rowEn(q))).join('')}</ol><p style="margin:0;">${closingEn}</p>`
      : `<p style="margin:0;">${en}</p>`;
    const emailAr = n > 1
      ? `<p style="margin:0 0 10px;">${introAr}</p><ol style="margin:0 0 10px; padding-right:20px; padding-left:0;">${quotes.map(q => listItem(rowAr(q))).join('')}</ol><p style="margin:0;">${closingAr}</p>`
      : `<p style="margin:0;">${ar}</p>`;

    return { fr, en, ar, emailFr, emailEn, emailAr };
  },

  refused: (data) => ({
    fr: `Bonjour ${data.name}, nous ne sommes malheureusement pas en mesure de traiter votre demande. Raison : ${data.reason}. Si vous pensez qu'il s'agit d'une erreur, ou pour en discuter, appelez-nous au ${COMPANY_PHONE}.`,
    en: `Hello ${data.name}, unfortunately we're unable to handle your request. Reason: ${data.reason}. If you believe this is a mistake, or to discuss it, please call us at ${COMPANY_PHONE}.`,
    ar: `مرحباً ${data.name}، للأسف لا يمكننا تلبية طلبكم. السبب: ${data.reason}. إذا كنتم تعتقدون أن هذا خطأ، أو للنقاش، يرجى الاتصال بنا على ${COMPANY_PHONE}.`
  }),

  rewake: (data) => ({
    fr: `Bonjour ${data.name}, nous n'avons pas eu de nouvelles concernant votre demande de devis. Nous restons disponibles si vous souhaitez y donner suite — n'hésitez pas à nous recontacter.`,
    en: `Hello ${data.name}, we haven't heard back regarding your quote request. We're still available if you'd like to move forward — feel free to reach out.`,
    ar: `مرحباً ${data.name}، لم نتلقَّ ردًّا بخصوص طلب عرض السعر. لا نزال متواجدين إذا رغبتم في المتابعة — لا تترددوا في التواصل معنا.`
  }),

  order_received: (data) => ({
    fr: `Bonjour ${data.name}, nous confirmons la réception de votre envoi (par téléphone/message). Il est en cours de traitement.`,
    en: `Hello ${data.name}, we confirm receipt of your shipment (by phone/message). It is now being processed.`,
    ar: `مرحباً ${data.name}، نؤكد استلام طلبكم (عبر الهاتف/رسالة). جاري العمل على معالجته.`
  }),

  order_shipped: (data) => ({
    fr: `Bonjour ${data.name}, votre envoi a été expédié. Vol N° ${data.flightNumber} — LTA N° ${data.lta}. Vous pouvez utiliser ces références pour le suivi.`,
    en: `Hello ${data.name}, your shipment has been shipped. Flight No. ${data.flightNumber} — Airway Bill (LTA) No. ${data.lta}. You can use these references to track it.`,
    ar: `مرحباً ${data.name}، تم شحن طلبكم. رقم الرحلة ${data.flightNumber} — رقم بوليصة الشحن الجوي (LTA) ${data.lta}. يمكنكم استخدام هذه المراجع للتتبع.`
  }),

  order_arrived: (data) => ({
    fr: `Bonjour ${data.name}, votre envoi est arrivé à destination. La facture (N° ${data.invoiceNumber}) vous a été envoyée par email.`,
    en: `Hello ${data.name}, your shipment has arrived at its destination. Invoice No. ${data.invoiceNumber} has been sent to your email.`,
    ar: `مرحباً ${data.name}، وصلت شحنتكم إلى وجهتها. تم إرسال الفاتورة رقم ${data.invoiceNumber} إلى بريدكم الإلكتروني.`
  }),

  order_late: (data) => ({
    fr: `Bonjour ${data.name}, votre envoi accuse un retard. Raison : ${data.reason}. Nous nous excusons pour la gêne occasionnée.`,
    en: `Hello ${data.name}, your shipment is running late. Reason: ${data.reason}. We apologize for the inconvenience.`,
    ar: `مرحباً ${data.name}، هناك تأخير في شحنتكم. السبب: ${data.reason}. نعتذر عن الإزعاج.`
  }),

  order_problem: (data) => ({
    fr: `Bonjour ${data.name}, un problème est survenu avec votre envoi : ${data.reason}. Merci de nous appeler au ${COMPANY_PHONE} ou de nous écrire à ${COMPANY_EMAIL} afin d'en discuter.`,
    en: `Hello ${data.name}, an issue has come up with your shipment: ${data.reason}. Please call us at ${COMPANY_PHONE} or email ${COMPANY_EMAIL} so we can resolve this together.`,
    ar: `مرحباً ${data.name}، هناك مشكل طرأ على شحنتكم: ${data.reason}. يرجى الاتصال بنا على ${COMPANY_PHONE} أو مراسلتنا على ${COMPANY_EMAIL} لمناقشة الأمر.`
  }),

  order_cancelled: (data) => ({
    fr: `Bonjour ${data.name}, votre envoi a été annulé. Raison : ${data.reason}. Pour toute question ou contestation, appelez-nous au ${COMPANY_PHONE} ou écrivez à ${COMPANY_EMAIL}.`,
    en: `Hello ${data.name}, your shipment has been cancelled. Reason: ${data.reason}. For any question or to dispute this, call us at ${COMPANY_PHONE} or email ${COMPANY_EMAIL}.`,
    ar: `مرحباً ${data.name}، تم إلغاء طلبكم. السبب: ${data.reason}. لأي سؤال أو للاعتراض، اتصلوا بنا على ${COMPANY_PHONE} أو راسلونا على ${COMPANY_EMAIL}.`
  }),

  invite_back_same: (data) => ({
    fr: `Bonjour ${data.name}, nous revenons vers vous : les circonstances ont changé et nous sommes désormais en mesure de traiter votre envoi. Nous serions ravis de travailler avec vous.`,
    en: `Hello ${data.name}, reaching back out: circumstances have changed and we're now able to handle your shipment. We'd be glad to work with you.`,
    ar: `مرحباً ${data.name}، نعاود التواصل معكم: لقد تغيرت الظروف وأصبحنا الآن قادرين على تلبية طلبكم. يسعدنا العمل معكم.`
  }),

  invite_back_other: (data) => ({
    fr: `Bonjour ${data.name}, nous revenons vers vous au sujet d'un autre service : ${data.serviceOffer}. Bien que nous n'ayons pas pu traiter votre précédente demande, ce service pourrait vous convenir.`,
    en: `Hello ${data.name}, reaching back out about a different service: ${data.serviceOffer}. While we couldn't handle your previous request, this may be a good fit for you.`,
    ar: `مرحباً ${data.name}، نتواصل معكم بخصوص خدمة أخرى: ${data.serviceOffer}. رغم أننا لم نتمكن من تلبية طلبكم السابق، فقد تناسبكم هذه الخدمة.`
  }),

  finish_success: (data) => ({
    fr: `Bonjour ${data.name}, merci d'avoir travaillé avec nous ! Nous espérons que tout s'est bien passé et sommes ravis d'avoir pu vous accompagner. N'hésitez pas à revenir vers nous pour un prochain envoi.`,
    en: `Hello ${data.name}, thank you for working with us! We hope everything went well and were glad to help. Feel free to reach out again for your next shipment.`,
    ar: `مرحباً ${data.name}، شكراً لتعاملكم معنا! نأمل أن كل شيء سار على ما يرام ويسعدنا أننا تمكنا من مساعدتكم. لا تترددوا في التواصل معنا مجدداً لشحنتكم القادمة.`
  }),

  finish_failed: (data) => ({
    fr: `Bonjour ${data.name}, nous tenons à nous excuser concernant votre envoi : ${data.reason}. Nous sommes sincèrement désolés pour la gêne occasionnée et restons à votre disposition au ${COMPANY_PHONE} pour en discuter.`,
    en: `Hello ${data.name}, we want to apologize regarding your shipment: ${data.reason}. We're truly sorry for the inconvenience and remain available at ${COMPANY_PHONE} to discuss it.`,
    ar: `مرحباً ${data.name}، نود الاعتذار بخصوص طلبكم: ${data.reason}. نأسف بصدق على الإزعاج ونبقى في خدمتكم على ${COMPANY_PHONE} لمناقشة الأمر.`
  })
};

/** Builds the SMS body: French only. SMS is billed per segment and any Arabic
 * text forces expensive Unicode encoding (~67 chars/segment instead of ~160),
 * so the 3-language version is reserved for email, where length is free. */
function composeSms(type, data) {
  const t = templates[type](data);
  // French then English, separated by a blank line - no Arabic here. French
  // accented characters (é, è, à, ç...) and English are both in the GSM-7
  // alphabet, so this still sends as a normal ~153-char/segment SMS; adding
  // Arabic would flip the whole message into ~67-char Unicode segments and
  // multiply the cost (see README "SMS cost & deliverability"), so Arabic
  // stays email-only.
  return `${t.fr}\n\n${t.en}`;
}

/** Builds a simple HTML email body with the same 3-language order, plus a
 * logo + signature footer so every automated email is branded regardless
 * of any Gmail-side signature/footer setting (those don't apply to mail
 * sent programmatically via SMTP - only to mail composed in Gmail itself). */
function composeEmailHtml(type, data) {
  const t = templates[type](data);
  const block = (text, dir) => `<p style="margin:0 0 16px; font-family:Arial,sans-serif; font-size:15px; color:#122B4A; direction:${dir};">${text}</p>`;
  // A template can provide emailFr/emailEn/emailAr - pre-built HTML (e.g. a
  // numbered list of quote options) to use instead of the plain fr/en/ar
  // text wrapped in a single <p>. Only ready_to_work does this today.
  const section = (html, dir) => `<div style="margin:0 0 16px; font-family:Arial,sans-serif; font-size:15px; color:#122B4A; direction:${dir};">${html}</div>`;
  const bodyFr = t.emailFr ? section(t.emailFr, 'ltr') : block(t.fr, 'ltr');
  const bodyEn = t.emailEn ? section(t.emailEn, 'ltr') : block(t.en, 'ltr');
  const bodyAr = t.emailAr ? section(t.emailAr, 'rtl') : block(t.ar, 'rtl');

  // Letterhead-style header: a solid navy banner with the logo on a white
  // roundel, so the email doesn't just start bare on white with "Bonjour".
  const header = `
    <div style="background:#1F3864; padding:24px 24px 18px; text-align:center; border-radius:8px 8px 0 0;">
      <div style="display:inline-block; background:#ffffff; padding:10px 16px; border-radius:6px;">
        <img src="https://raw.githubusercontent.com/Moh1uts/United-Transport-Solutions/main/src/assets/uts_logo.png" width="150" alt="${COMPANY_NAME}" style="display:block;">
      </div>
    </div>
  `;

  const signature = `
    <div style="margin-top:28px; padding-top:20px; border-top:2px solid #C9972A;">
      <p style="margin:0; font-family:Arial,sans-serif; font-size:14px; font-weight:bold; color:#122B4A;">${COMPANY_NAME}</p>
      <p style="margin:2px 0 0; font-family:Arial,sans-serif; font-size:13px; color:#444;">${COMPANY_PHONE}</p>
      <p style="margin:2px 0 0; font-family:Arial,sans-serif; font-size:13px; color:#444;">
        <a href="mailto:${COMPANY_EMAIL}" style="color:#1F3864; text-decoration:none;">${COMPANY_EMAIL}</a>
      </p>
      <p style="margin:2px 0 0; font-family:Arial,sans-serif; font-size:13px;">
        <a href="https://www.unitedtransportsolutions.com" style="color:#1F3864; text-decoration:none;">www.unitedtransportsolutions.com</a>
      </p>
    </div>
  `;

  return `
    <div style="max-width:520px; margin:0 auto; background:#F7F5F0; border-radius:8px; overflow:hidden;">
      ${header}
      <div style="padding:24px;">
        ${bodyFr}
        <hr style="border:none; border-top:1px solid #ddd; margin:16px 0;">
        ${bodyEn}
        <hr style="border:none; border-top:1px solid #ddd; margin:16px 0;">
        ${bodyAr}
        ${signature}
      </div>
    </div>
  `;
}

/** Subject line shown in the client's inbox, per message type (FR / EN / AR combined, short). */
const subjects = {
  quote_received: 'Devis reçu / Quote received / تم استلام الطلب',
  ready_to_work: 'Nous sommes prêts / We are ready / نحن جاهزون',
  refused: 'Concernant votre demande / About your request / بخصوص طلبكم',
  rewake: 'Toujours disponibles / Still available / لا زلنا متواجدين',
  order_received: 'Envoi reçu / Shipment received / تم استلام الشحنة',
  order_shipped: 'Envoi expédié / Shipment sent / تم شحن الطلب',
  order_arrived: 'Envoi arrivé - Facture / Shipment arrived - Invoice / وصول الشحنة - الفاتورة',
  order_late: 'Retard de livraison / Shipping delay / تأخير في الشحن',
  order_problem: 'Problème avec votre envoi / Issue with your shipment / مشكل في الشحنة',
  order_cancelled: 'Envoi annulé / Shipment cancelled / تم إلغاء الشحنة',
  invite_back_same: 'Nous revenons vers vous / Reaching back out / نعاود التواصل',
  invite_back_other: 'Un autre service pour vous / Another service for you / خدمة أخرى لكم',
  finish_success: 'Merci ! / Thank you! / شكراً لكم',
  finish_failed: 'Nos excuses / Our apologies / اعتذارنا'
};

// ---------------------------------------------------------------------------
// Internal "new quote" alert - sent to the business owner (dad), not the
// client. Text (SMS) only, per business decision - no email version.
// French only, since it's an internal tool, not a client-facing message,
// so the FR/EN/AR rule above doesn't apply here.
// ---------------------------------------------------------------------------

/** Short SMS alert: just enough to know a new lead came in and glance at
 * the essentials before opening the dashboard. */
function composeOwnerAlertSms(client) {
  const bits = [
    client.phone || '—',
    `${client.city || '—'} → ${client.destination || '—'}`,
    client.nature || '—'
  ];
  if (client.weightKg) bits.push(`${client.weightKg} kg`);
  if (client.packages) bits.push(`${client.packages} colis`);
  return `Nouveau devis reçu sur le site (${client.name}) : ${bits.join(' — ')}. Ouvrez le dashboard pour répondre.`;
}

module.exports = { composeSms, composeEmailHtml, subjects, composeOwnerAlertSms, COMPANY_NAME, COMPANY_PHONE, COMPANY_EMAIL };

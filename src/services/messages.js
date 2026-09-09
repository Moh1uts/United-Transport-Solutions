// src/services/messages.js
//
// Every client-facing message (SMS + email) is composed in French, then
// English, then Arabic, in that fixed order, per business requirement.
//
// Two versions of each message exist:
//   - `sms`   : short, plain text (SMS is billed per 160-char segment, and
//               ANY Arabic/unicode content forces the whole message into
//               70-char UCS-2 segments - see README "SMS cost note")
//   - `email` : fuller text, rendered as simple HTML with the 3 languages
//               stacked and separated by a rule
//
// COMPANY_NAME / COMPANY_PHONE / COMPANY_EMAIL come from environment
// variables so they're not hard-coded in source.

const COMPANY_NAME = process.env.COMPANY_NAME || 'United Transport Solutions';
const COMPANY_PHONE = process.env.COMPANY_PHONE || '+212 700-172779';
const COMPANY_EMAIL = process.env.COMPANY_EMAIL || 'contact@unitedtransportsolutions.com';

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

  ready_to_work: (data) => ({
    fr: `Bonjour ${data.name}, bonne nouvelle : suite à votre demande de devis, nous sommes prêts à traiter votre envoi. Nous vous proposons un tarif de ${data.pricePerKg} DHS/kg. N'hésitez pas à nous appeler au ${COMPANY_PHONE} ou à nous écrire à ${COMPANY_EMAIL} si vous souhaitez ajuster ce tarif.`,
    en: `Hello ${data.name}, good news: following your quote request, we're ready to handle your shipment. We're offering a rate of ${data.pricePerKg} DHS/kg. Feel free to call us at ${COMPANY_PHONE} or email ${COMPANY_EMAIL} if you'd like to discuss adjusting this rate.`,
    ar: `مرحباً ${data.name}، خبر سار: بناءً على طلب عرض السعر الخاص بكم، نحن جاهزون للتكفل بشحنتكم. نقترح عليكم سعر ${data.pricePerKg} درهم/كلغ. لا تترددوا في الاتصال بنا على ${COMPANY_PHONE} أو مراسلتنا على ${COMPANY_EMAIL} إذا رغبتم في مناقشة تعديل هذا السعر.`
  }),

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

/** Builds the SMS body: FR, then EN, then AR, separated by a blank line. */
function composeSms(type, data) {
  const t = templates[type](data);
  return [t.fr, t.en, t.ar].join('\n\n');
}

/** Builds a simple HTML email body with the same 3-language order. */
function composeEmailHtml(type, data) {
  const t = templates[type](data);
  const block = (text, dir) => `<p style="margin:0 0 16px; font-family:Arial,sans-serif; font-size:15px; color:#122B4A; direction:${dir};">${text}</p>`;
  return `
    <div style="max-width:520px; margin:0 auto; padding:24px;">
      ${block(t.fr, 'ltr')}
      <hr style="border:none; border-top:1px solid #ddd; margin:16px 0;">
      ${block(t.en, 'ltr')}
      <hr style="border:none; border-top:1px solid #ddd; margin:16px 0;">
      ${block(t.ar, 'rtl')}
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

module.exports = { composeSms, composeEmailHtml, subjects, COMPANY_NAME, COMPANY_PHONE, COMPANY_EMAIL };

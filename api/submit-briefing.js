function isDiscordWebhook(url) {
  return /discord\.com\/api\/webhooks/i.test(url);
}

function buildDiscordPayload(briefing, receivedAt, empresa, arte) {
  const when = new Date(receivedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const text = briefing.length > 3900 ? briefing.slice(0, 3900) + '\n\n…(texto truncado)' : briefing;
  const emp = empresa || 'Empresa';
  const art = arte || 'Arte';
  return {
    embeds: [{
      title: `📋 Briefing — ${emp} — ${art}`,
      description: text,
      color: 0xc8a96e,
      footer: { text: `Recebido em ${when}` }
    }]
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const briefing = req.body?.briefing;
  const empresa = req.body?.empresa || '';
  const arte = req.body?.arte || '';
  if (!briefing || typeof briefing !== 'string') {
    return res.status(400).json({ error: 'Briefing required' });
  }

  const recipient = process.env.BRIEFING_RECIPIENT_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Briefing Quora <onboarding@resend.dev>';
  const webhookUrl = process.env.BRIEFING_WEBHOOK_URL;

  if (!webhookUrl && !(recipient && resendKey)) {
    console.error('submit-briefing: configure BRIEFING_WEBHOOK_URL (Discord) ou e-mail Resend');
    return res.status(500).json({ error: 'Delivery not configured' });
  }

  const receivedAt = new Date().toISOString();
  const subject = `Briefing — ${empresa || 'Cliente'} — ${arte || 'Arte'} — ${new Date().toLocaleDateString('pt-BR')}`;
  const errors = [];

  try {
    if (webhookUrl) {
      const payload = isDiscordWebhook(webhookUrl)
        ? buildDiscordPayload(briefing, receivedAt, empresa, arte)
        : { briefing, receivedAt, empresa, arte, source: 'quora-briefing' };
      const wh = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!wh.ok) {
        const errBody = await wh.text();
        console.error('Webhook error:', wh.status, errBody);
        errors.push(`webhook:${wh.status}`);
      }
    }

    if (recipient && resendKey) {
      const mail = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [recipient],
          subject,
          text: briefing
        })
      });
      if (!mail.ok) {
        const errBody = await mail.text();
        console.error('Resend error:', mail.status, errBody);
        errors.push(`email:${mail.status}`);
      }
    } else if (recipient && !resendKey) {
      errors.push('email:no_api_key');
    }

    if (errors.length) {
      return res.status(500).json({ error: 'Delivery failed', details: errors });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('submit-briefing:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

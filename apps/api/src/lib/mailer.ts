import type { Locale } from '@peciatka/shared';
import { config } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Разработка: письмо выводится в консоль, ссылку можно скопировать оттуда. */
export class ConsoleMailer implements Mailer {
  async send(mail: Mail) {
    console.log(`\n📧 To: ${mail.to}\n   Subject: ${mail.subject}\n\n${mail.text}\n`);
  }
}

/** Тесты: письма складываются в массив. */
export class MemoryMailer implements Mailer {
  outbox: Mail[] = [];
  async send(mail: Mail) {
    this.outbox.push(mail);
  }
}

/** Продакшен: Resend через HTTP API, без SDK. */
export class ResendMailer implements Mailer {
  constructor(private apiKey: string) {}
  async send(mail: Mail) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text }),
    });
    if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
  }
}

export function createMailer(): Mailer {
  return config.RESEND_API_KEY ? new ResendMailer(config.RESEND_API_KEY) : new ConsoleMailer();
}

// ───────── Шаблоны ─────────

const app = config.APP_NAME;

export const mailTemplates = {
  invite: (locale: Locale, p: { salonName: string; url: string }): Omit<Mail, 'to'> =>
    ({
      sk: {
        subject: `Pozvánka do salónu ${p.salonName}`,
        text: `Dobrý deň,\n\nsalón ${p.salonName} vás pozýva do aplikácie ${app}, kde budete pridávať pečiatky na vernostné karty klientov.\n\nPozvánku prijmete tu (platí 7 dní):\n${p.url}\n`,
      },
      en: {
        subject: `Invitation to ${p.salonName}`,
        text: `Hello,\n\n${p.salonName} invites you to ${app}, where you'll add stamps to customers' loyalty cards.\n\nAccept the invitation here (valid for 7 days):\n${p.url}\n`,
      },
      uk: {
        subject: `Запрошення до салону ${p.salonName}`,
        text: `Вітаємо!\n\nСалон ${p.salonName} запрошує вас до ${app}, де ви ставитимете штампи на картки лояльності клієнтів.\n\nПрийняти запрошення (дійсне 7 днів):\n${p.url}\n`,
      },
    })[locale],

  passwordReset: (locale: Locale, p: { url: string }): Omit<Mail, 'to'> =>
    ({
      sk: {
        subject: `${app}: obnovenie hesla`,
        text: `Dobrý deň,\n\nnové heslo si nastavíte tu (odkaz platí 1 hodinu):\n${p.url}\n\nAk ste o obnovenie nežiadali, tento e-mail ignorujte.\n`,
      },
      en: {
        subject: `${app}: password reset`,
        text: `Hello,\n\nset a new password here (link valid for 1 hour):\n${p.url}\n\nIf you didn't request this, ignore this email.\n`,
      },
      uk: {
        subject: `${app}: відновлення пароля`,
        text: `Вітаємо!\n\nВстановіть новий пароль тут (посилання дійсне 1 годину):\n${p.url}\n\nЯкщо ви не надсилали запит, просто проігноруйте цей лист.\n`,
      },
    })[locale],
};

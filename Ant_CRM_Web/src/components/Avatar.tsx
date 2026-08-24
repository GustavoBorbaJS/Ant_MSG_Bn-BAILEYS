import { userAvatarUrl } from '../lib/api';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

// Foto de perfil se o usuario tiver uma (ver Ant_CRM_Bn/src/auth/auth.controller.ts),
// senao um circulo com as iniciais do nome - nunca fica em branco.
export function Avatar({
  userId,
  name,
  avatarFilename,
  size = 32,
}: {
  userId: string;
  name: string;
  avatarFilename: string | null | undefined;
  size?: number;
}) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.4) };

  if (avatarFilename) {
    return (
      <img
        src={userAvatarUrl(userId)}
        alt={name}
        style={style}
        className="shrink-0 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10"
      />
    );
  }

  return (
    <div
      style={style}
      className="flex shrink-0 items-center justify-center rounded-full bg-emerald-600 font-semibold text-white dark:bg-emerald-500"
    >
      {initials(name)}
    </div>
  );
}

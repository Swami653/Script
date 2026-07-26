import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth-guards";
import { ROLE_HOME } from "@/lib/roles";

/** Точка входа: каждого пользователя отправляем в его раздел. */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(ROLE_HOME[user.role]);
}

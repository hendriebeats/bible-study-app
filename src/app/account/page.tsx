import { redirect } from "next/navigation";

/**
 * `/account` is a virtual root — the real content lives in the three nested
 * pages (`profile`, `preferences`, `security`). Hitting the bare path lands on
 * Profile, matching how `/account` historically behaved (the previous flat
 * page led with the profile card).
 */
export default function AccountIndex() {
  redirect("/account/profile");
}

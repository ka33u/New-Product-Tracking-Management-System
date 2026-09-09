import { Icon } from "./ui";

/** Local sign-out must remain a same-origin POST, including error pages. */
export function SignOutControl({ path, label = "退出", className }: {
  path: string; label?: string; className?: string;
}) {
  const content = <><Icon name="exit" />{label}</>;
  return path === "/api/local-auth/logout"
    ? <form action={path} method="post"><button type="submit" className={className} title="退出当前账户">{content}</button></form>
    : <a href={path} className={className} title="退出当前账户">{content}</a>;
}

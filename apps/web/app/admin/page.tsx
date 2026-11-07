import AccountGate from "@/components/account-gate";
import AdminUsers from "@/components/admin-users";
export const metadata = {
  title: "Пользователи — Doompile",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <AccountGate adminOnly>
      <AdminUsers />
    </AccountGate>
  );
}

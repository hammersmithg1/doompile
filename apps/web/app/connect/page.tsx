import AccountGate from "@/components/account-gate";
import ConnectDevice from "@/components/connect-device";
export const metadata = {
  title: "Подключить приложение — Doompile",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  return (
    <AccountGate>
      <ConnectDevice code={(await searchParams).code || ""} />
    </AccountGate>
  );
}

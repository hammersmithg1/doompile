import Doompile from "@/components/doompile";
import AccountGate from "@/components/account-gate";
export default function Page() {
  return (
    <AccountGate>
      <Doompile />
    </AccountGate>
  );
}

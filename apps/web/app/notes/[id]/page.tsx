import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { noteIDPattern } from "@doompile/core";
import Doompile from "@/components/doompile";
import AccountGate from "@/components/account-gate";
export const metadata: Metadata = {
  title: "Заметка — Doompile",
  robots: { index: false, follow: false },
};
export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!noteIDPattern.test(id)) notFound();
  return <AccountGate><Doompile initialNoteID={id.toLowerCase()} /></AccountGate>;
}

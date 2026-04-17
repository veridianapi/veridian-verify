import { notFound } from "next/navigation";
import { getSession } from "./actions";
import { VerificationFlow } from "./VerificationFlow";

export default async function VerificationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const session = await getSession(token);
  if (!session) {
    notFound();
  }

  return <VerificationFlow token={token} />;
}

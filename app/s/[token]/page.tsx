import { VerificationFlow } from "./VerificationFlow";

export default async function VerificationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <VerificationFlow token={token} />;
}

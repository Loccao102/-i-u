import type { Metadata } from "next";
import { GroupPollClient } from "@/components/group-poll-client";

export const metadata: Metadata = {
  title: "Vote nhóm — ĐiĐâu",
  description: "Chọn nhanh một địa điểm cùng bạn bè trên ĐiĐâu.",
  robots: { index: false, follow: false }
};

type GroupPollPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function GroupPollPage({
  params
}: GroupPollPageProps) {
  const { slug } = await params;
  return <GroupPollClient slug={slug} />;
}

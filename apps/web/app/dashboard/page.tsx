import { Suspense } from "react";
import ChartClient from "@/components/ChartClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 text-white">Loading chart...</div>}>
      <ChartClient />
    </Suspense>
  );
}
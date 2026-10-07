import { apiMember, json } from "@/lib/auth/api";
import { getTechSnapshot, NotATechnicianError } from "@/lib/server/tech-sync";

// FR-TEC-01: the technician's next two days, for the device to keep.
export async function GET(request: Request) {
  const member = await apiMember(request);
  if (member instanceof Response) return member;
  try {
    return json(await getTechSnapshot(member));
  } catch (error) {
    if (error instanceof NotATechnicianError) return json({ error: error.message }, 409);
    throw error;
  }
}

import type { Face } from '@/components/Avatar';

export type TripStatus = 'active' | 'revealed' | 'archived';

export type Trip = {
  id: string;
  name: string;
  start_date: string; // ISO, 'YYYY-MM-DD'
  end_date: string;
  status: TripStatus;
  owner_id: string;
  members: Face[]; // faces for the overlapping avatars on the card
  member_count: number;
  my_post_count: number;
};

export type TripMember = {
  user_id: string;
  role: 'owner' | 'member';
  username: string;
  display_name: string;
  avatar_key: string | null;
};

export type InvitePreview = {
  trip_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: TripStatus;
  member_count: number;
  owner_display_name: string;
};

export type RedeemResult =
  | { status: 'joined' | 'already_member'; trip_id: string }
  | { status: 'not_found' | 'not_active'; trip_id: string | null };

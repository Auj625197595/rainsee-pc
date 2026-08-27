export interface IFormFillData {
  _id?: string;
  updatedAt?: number;
  type?: 'password' | 'address';
  url?: string;
  favicon?: string;
  fields?: {
    username?: string;
    passLength?: number;
    password?: string;
    name?: string;
    address?: string;
    postCode?: string;
    city?: string;
    phone?: string;
    email?: string;
    country?: string;
  };
}

export interface IFormFillMenuItem {
  _id?: string;
  text?: string;
  subtext?: string;
  passwordMask?: string;
  host?: string;
}

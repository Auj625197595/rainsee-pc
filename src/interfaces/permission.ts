export interface IPermissionRecord {
  _id?: string;
  url: string;
  permission: string;
  type: 1 | 2 | 3;
  mediaTypes: string;
}

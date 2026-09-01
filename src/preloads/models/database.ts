// 导入 makeId 函数，用于生成唯一标识符
import {ipcRenderer} from '~/common/renderer-ipc';

// 定义泛型接口 IAction，用于描述数据库操作的动作
interface IAction<T> {
  item?: Partial<T>; // 操作的对象的部分信息
  query?: Partial<T>; // 查询条件的部分信息
  multi?: boolean; // 是否进行多项操作的标志
  value?: Partial<T>; // 新值的部分信息（用于更新操作）
}

// 定义 PreloadDatabase 类
export class PreloadDatabase<T> {
  private scope: string; // 数据库范围

  // 构造函数，接受一个字符串参数作为数据库范围
  public constructor(scope: string) {
    this.scope = scope;
  }

  // 执行数据库操作的私有方法
  private async performOperation(
    operation: 'get' | 'get-one' | 'update' | 'insert' | 'remove', // 操作类型
    data: IAction<T>, // 操作所需的数据
  ): Promise<any> {
    return ipcRenderer.invoke(`storage-${operation}`, {
      scope: this.scope,
      ...data,
    });
  }

  // 插入操作，向数据库中插入新数据
  public async insert(item: T): Promise<T> {
    return await this.performOperation('insert', { item });
  }

  // 查询操作，从数据库中获取数据集合
  public async get(query: T): Promise<T[]> {
    return await this.performOperation('get', { query });
  }

  // 单个查询操作，从数据库中获取单个数据
  public async getOne(query: T): Promise<T[]> {
    return await this.performOperation('get-one', { query });
  }

  // 更新操作，更新数据库中的数据
  public async update(query: T, newValue: T, multi = false): Promise<number> {
    return await this.performOperation('update', {
      query,
      value: newValue,
      multi,
    });
  }

  // 删除操作，从数据库中删除数据
  public async remove(query: T, multi = false): Promise<T> {
    return await this.performOperation('remove', { query, multi });
  }
}

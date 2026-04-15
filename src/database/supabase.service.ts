import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  SupabaseClient,
  AuthResponse,
  User,
} from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private client: SupabaseClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('database.supabaseUrl');
    const supabaseKey = this.configService.get<string>(
      'database.supabaseServiceRoleKey',
    );

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL and Service Role Key must be provided');
    }

    // Temporary log to verify key role
    try {
      const payload = JSON.parse(
        Buffer.from(supabaseKey.split('.')[1], 'base64').toString(),
      );
      this.logger.log('Supabase key role: ' + payload.role);
    } catch {
      this.logger.warn('Could not decode Supabase key');
    }

    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log('Supabase client initialized');
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  from(table: string) {
    return this.client.from(table);
  }

  storage() {
    return this.client.storage;
  }

  // Auth methods
  async signUp(email: string, password: string): Promise<AuthResponse> {
    this.logger.log('Using admin.createUser for: ' + email);
    const { data, error } = await this.client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    return {
      data: { user: data?.user ?? null, session: null },
      error,
    } as AuthResponse;
  }

  async signIn(email: string, password: string): Promise<AuthResponse> {
    return this.client.auth.signInWithPassword({ email, password });
  }

  async signOut(token: string): Promise<{ error: Error | null }> {
    return this.client.auth.admin.signOut(token);
  }

  async getUser(
    token: string,
  ): Promise<{ data: { user: User | null }; error: Error | null }> {
    return this.client.auth.getUser(token);
  }

  async refreshToken(refreshToken: string): Promise<AuthResponse> {
    return this.client.auth.refreshSession({ refresh_token: refreshToken });
  }

  async adminGetUserById(
    userId: string,
  ): Promise<{ data: { user: User | null }; error: Error | null }> {
    return this.client.auth.admin.getUserById(userId);
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const { error } = await this.client
        .from('profiles')
        .select('count', { count: 'exact', head: true });
      return !error;
    } catch {
      return false;
    }
  }
}

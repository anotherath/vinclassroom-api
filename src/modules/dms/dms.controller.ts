import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DMsService } from './dms.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CreateDMConversationDto,
  SendDMDto,
  QueryDMMessagesDto,
  QueryDMConversationsDto,
} from './dto';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
  };
}

@ApiTags('Direct Messages')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('dms')
export class DMsController {
  constructor(private readonly dmsService: DMsService) {}

  /**
   * POST /dms
   * Get or create DM conversation
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrGetConversation(
    @Body() dto: CreateDMConversationDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const conversation = await this.dmsService.getOrCreateConversation(
      req.user.id,
      dto,
    );
    return {
      success: true,
      data: conversation,
    };
  }

  /**
   * GET /dms
   * Get user's DM conversations
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getConversations(
    @Query() query: QueryDMConversationsDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const result = await this.dmsService.getConversations(req.user.id, query);
    return {
      success: true,
      data: result.conversations,
      meta: {
        total: result.total,
        hasMore: result.hasMore,
        page: query.page || 1,
        limit: query.limit || 20,
      },
    };
  }

  /**
   * GET /dms/:conversationId/messages
   * Get messages in a DM conversation
   */
  @Get(':conversationId/messages')
  @HttpCode(HttpStatus.OK)
  async getMessages(
    @Param('conversationId') conversationId: string,
    @Query() query: QueryDMMessagesDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const result = await this.dmsService.getMessages(
      conversationId,
      req.user.id,
      query,
    );
    return {
      success: true,
      data: result.messages,
      meta: {
        total: result.total,
        hasMore: result.hasMore,
        page: query.page || 1,
        limit: query.limit || 20,
      },
    };
  }

  /**
   * POST /dms/:conversationId/messages
   * Send a message in DM conversation
   */
  @Post(':conversationId/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @Param('conversationId') conversationId: string,
    @Body() dto: SendDMDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const message = await this.dmsService.sendMessage(
      conversationId,
      req.user.id,
      dto,
    );
    return {
      success: true,
      data: message,
    };
  }

  /**
   * DELETE /dms/messages/:messageId
   * Delete a DM message
   */
  @Delete('messages/:messageId')
  @HttpCode(HttpStatus.OK)
  async deleteMessage(
    @Param('messageId') messageId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.dmsService.deleteMessage(messageId, req.user.id);
    return {
      success: true,
      message: 'Message deleted successfully',
    };
  }

  /**
   * POST /dms/:conversationId/read
   * Mark all messages in conversation as read
   */
  @Post(':conversationId/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Param('conversationId') conversationId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.dmsService.markAsRead(conversationId, req.user.id);
    return {
      success: true,
      message: 'Messages marked as read',
    };
  }

  /**
   * POST /dms/block/:userId
   * Block a user
   */
  @Post('block/:userId')
  @HttpCode(HttpStatus.OK)
  async blockUser(
    @Param('userId') userId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.dmsService.blockUser(req.user.id, userId);
    return {
      success: true,
      message: 'User blocked successfully',
    };
  }

  /**
   * DELETE /dms/block/:userId
   * Unblock a user
   */
  @Delete('block/:userId')
  @HttpCode(HttpStatus.OK)
  async unblockUser(
    @Param('userId') userId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.dmsService.unblockUser(req.user.id, userId);
    return {
      success: true,
      message: 'User unblocked successfully',
    };
  }

  /**
   * GET /dms/blocked
   * Get blocked users list
   */
  @Get('blocked/list')
  @HttpCode(HttpStatus.OK)
  async getBlockedUsers(@Request() req: RequestWithUser): Promise<any> {
    const blocked = await this.dmsService.getBlockedUsers(req.user.id);
    return {
      success: true,
      data: blocked,
    };
  }
}
